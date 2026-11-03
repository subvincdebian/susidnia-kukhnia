import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {root} from './database.mjs';

export function validateDemo(data) {
  const fail=()=>{throw new Error('Некоректний набір демонстраційних даних');};
  const string=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
  const timestamp=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)&&Number.isFinite(Date.parse(value.replace(' ','T')+'Z'));
  const keyed=rows=>Array.isArray(rows)&&rows.length>0&&rows.every(r=>r&&string(r.key,100)&&/^[a-z0-9-]+$/.test(r.key))&&new Set(rows.map(r=>r.key)).size===rows.length;
  if(!data||!string(data.version,100)||!/^[a-z0-9-]+$/.test(data.version)||!keyed(data.customers)||!keyed(data.couriers)||!keyed(data.orders))fail();
  const customers=new Set(data.customers.map(r=>r.key)),couriers=new Set(data.couriers.map(r=>r.key));
  if(new Set(data.customers.map(r=>r.email)).size!==data.customers.length||new Set(data.customers.map(r=>r.phone)).size!==data.customers.length||new Set(data.couriers.map(r=>r.phone)).size!==data.couriers.length)fail();
  for(const c of data.customers)if(!string(c.name,100)||!string(c.email,100)||!/^\S+@\S+\.\S+$/.test(c.email)||!/^\+380\d{9}$/.test(c.phone)||!string(c.address,200)||!timestamp(c.created_at))fail();
  for(const c of data.couriers)if(!string(c.name,100)||!/^\+380\d{9}$/.test(c.phone)||!['пішки','велосипед','скутер','автомобіль'].includes(c.vehicle))fail();
  for(const o of data.orders){
    if(!customers.has(o.customer)||!string(o.restaurant,100)||!timestamp(o.date)||!['створено','готується','в дорозі','доставлено','скасовано'].includes(o.status)||typeof o.note!=='string'||o.note.length>500||!Array.isArray(o.items)||!o.items.length||o.items.length>40)fail();
    if(new Set(o.items.map(i=>i.dish)).size!==o.items.length)fail();
    for(const i of o.items)if(!string(i.dish,100)||!Number.isInteger(i.quantity)||i.quantity<1||i.quantity>99||i.unit_price!=null&&(!/^\d{1,8}\.\d{2}$/.test(i.unit_price)||Number(i.unit_price)<=0))fail();
    const dispatched=o.status==='в дорозі'||o.status==='доставлено'||o.cancel_after_dispatch===true;
    if(dispatched&&!couriers.has(o.courier)||!dispatched&&o.courier!=null||o.cancel_after_dispatch!=null&&(o.cancel_after_dispatch!==true||o.status!=='скасовано'))fail();
    if(o.status==='доставлено'?!['картка','готівка'].includes(o.payment):o.payment!=null)fail();
    if(o.review&&(o.status!=='доставлено'||!Number.isInteger(o.review.rating)||o.review.rating<1||o.review.rating>5||!string(o.review.comment,2000)))fail();
    if(o.date<data.customers.find(c=>c.key===o.customer).created_at)fail();
  }
  const active=data.orders.filter(o=>o.status==='в дорозі').map(o=>o.courier);
  if(new Set(active).size!==active.length)fail();
}

export async function applyDemoData(db,data) {
  validateDemo(data);
  const checksum=createHash('sha256').update(JSON.stringify(data)).digest('hex');
  await db.query('BEGIN');
  try {
    await db.query("SET LOCAL lock_timeout='15s'");
    await db.query('SELECT pg_advisory_xact_lock(718202626)');
    const existing=(await db.query('SELECT source_sha256,summary FROM _app_data_seeds WHERE name=$1',[data.version])).rows[0];
    if(existing){
      if(existing.source_sha256!==checksum)throw new Error('Демонстраційний набір уже застосовано з іншим вмістом. Наявні записи не змінено.');
      await db.query('COMMIT');return {applied:false,summary:existing.summary};
    }
    const customers=new Map(),couriers=new Map(),restaurants=new Map(),dishes=new Map(),orderIds={};
    let addedCustomers=0;
    for(const c of data.customers){
      const previous=(await db.query("SELECT id,to_char(created_at,'YYYY-MM-DD HH24:MI:SS') AS created_at FROM customers WHERE email=$1 FOR SHARE",[c.email])).rows[0];
      if(previous){
        const earliest=data.orders.filter(o=>o.customer===c.key).map(o=>o.date).sort()[0];
        if(earliest&&previous.created_at>earliest)throw new Error('Наявного клієнта створено пізніше демонстраційних замовлень. Записи не змінено.');
        customers.set(c.key,previous.id);
      }
      else {
        const {rows:[row]}=await db.query('INSERT INTO customers(full_name,email,phone,default_delivery_address,created_at) VALUES($1,$2,$3,$4,$5::timestamp) RETURNING id',[c.name,c.email,c.phone,c.address,c.created_at]);
        customers.set(c.key,row.id);addedCustomers++;
      }
    }
    for(const c of data.couriers){
      const {rows:[row]}=await db.query('INSERT INTO couriers(full_name,phone,vehicle_type,is_available) VALUES($1,$2,$3,TRUE) RETURNING id',[c.name,c.phone,c.vehicle]);
      couriers.set(c.key,row.id);
    }
    for(const key of new Set(data.orders.map(o=>o.restaurant))){
      const {rows:[row]}=await db.query('SELECT id,is_active FROM restaurants WHERE catalog_key=$1 FOR SHARE',[key]);
      if(!row?.is_active)throw new Error(`Демонстраційний заклад ${key} відсутній або вимкнений. Наявні записи не змінено.`);
      restaurants.set(key,row.id);
    }
    for(const o of data.orders){
      for(const item of o.items){
        const key=o.restaurant+'\n'+item.dish;if(dishes.has(key))continue;
        const result=await db.query('SELECT id,price FROM menu_items WHERE restaurant_id=$1 AND name=$2 AND is_available=TRUE FOR SHARE',[restaurants.get(o.restaurant),item.dish]);
        if(result.rowCount!==1)throw new Error(`Демонстраційну страву ${item.dish} не знайдено однозначно. Наявні записи не змінено.`);
        dishes.set(key,result.rows[0]);
      }
    }
    for(const o of data.orders){
      const customer=data.customers.find(c=>c.key===o.customer);
      const {rows:[order]}=await db.query('INSERT INTO orders(customer_id,restaurant_id,order_date,delivery_address,delivery_note) VALUES($1,$2,$3::timestamp,$4,$5) RETURNING id',[customers.get(o.customer),restaurants.get(o.restaurant),o.date,customer.address,o.note]);
      orderIds[o.key]=order.id;
      for(const item of o.items){
        const d=dishes.get(o.restaurant+'\n'+item.dish);
        await db.query('INSERT INTO order_items(order_id,menu_item_id,quantity,unit_price) VALUES($1,$2,$3,$4)',[order.id,d.id,item.quantity,item.unit_price??d.price]);
      }
      if(o.status==='створено')continue;
      await db.query("UPDATE orders SET delivery_status='готується' WHERE id=$1",[order.id]);
      if(o.status==='готується')continue;
      const dispatched=o.status==='в дорозі'||o.status==='доставлено'||o.cancel_after_dispatch===true;
      if(!dispatched){await db.query("UPDATE orders SET delivery_status='скасовано' WHERE id=$1",[order.id]);continue;}
      const courierId=couriers.get(o.courier);
      const reserved=await db.query('UPDATE couriers SET is_available=FALSE WHERE id=$1 AND is_available=TRUE RETURNING id',[courierId]);
      if(reserved.rowCount!==1)throw new Error('Демонстраційний кур’єр уже зайнятий. Наявні записи не змінено.');
      await db.query("UPDATE orders SET delivery_status='в дорозі',courier_id=$1 WHERE id=$2",[courierId,order.id]);
      if(o.status==='в дорозі')continue;
      if(o.status==='доставлено'){
        await db.query("INSERT INTO payments(order_id,amount,method,paid_at) SELECT id,total_amount,$2,$3::timestamp+INTERVAL '45 minutes' FROM orders WHERE id=$1",[order.id,o.payment,o.date]);
        await db.query("UPDATE orders SET delivery_status='доставлено' WHERE id=$1",[order.id]);
      }else await db.query("UPDATE orders SET delivery_status='скасовано' WHERE id=$1",[order.id]);
      await db.query('UPDATE couriers SET is_available=TRUE WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM orders WHERE courier_id=$1 AND delivery_status=\'в дорозі\')',[courierId]);
      if(o.review)await db.query("INSERT INTO reviews(order_id,rating,comment,created_at) VALUES($1,$2,$3,$4::timestamp+INTERVAL '75 minutes')",[order.id,o.review.rating,o.review.comment,o.date]);
    }
    const ids=Object.values(orderIds);
    const {rows:[totals]}=await db.query("SELECT COUNT(*)::integer AS orders, SUM(total_amount)::text AS total_amount, SUM(total_amount) FILTER(WHERE delivery_status='доставлено')::text AS delivered_amount FROM orders WHERE id=ANY($1::integer[])",[ids]);
    const statuses=(await db.query('SELECT delivery_status,COUNT(*)::integer AS count FROM orders WHERE id=ANY($1::integer[]) GROUP BY delivery_status ORDER BY delivery_status',[ids])).rows;
    const summary={customers:data.customers.length,added_customers:addedCustomers,couriers:data.couriers.length,...totals,order_items:data.orders.reduce((sum,o)=>sum+o.items.length,0),payments:data.orders.filter(o=>o.payment).length,reviews:data.orders.filter(o=>o.review).length,statuses,order_ids:orderIds};
    await db.query('INSERT INTO _app_data_seeds(name,source_sha256,summary) VALUES($1,$2,$3::jsonb)',[data.version,checksum,JSON.stringify(summary)]);
    await db.query('COMMIT');return {applied:true,summary};
  }catch(error){await db.query('ROLLBACK');throw error;}
}

export async function seedDemoDatabase(config) {
  if(process.env.DELIVERY_DEMO_DATA==='0')return {applied:false,summary:null};
  const db=new pg.Client(config);await db.connect();
  try {
    const {rows:[row]}=await db.query('SELECT current_database() AS name');
    if(row.name!=='food_delivery_catalog')throw new Error('Автоматичні демонстраційні дані дозволені лише в окремій food_delivery_catalog.');
    const data=JSON.parse(await fs.readFile(path.join(root,'data/demo.json'),'utf8'));
    const result=await applyDemoData(db,data);
    if(result.applied)console.log(`Демонстраційні дані: ${result.summary.orders} замовлень, ${result.summary.payments} оплат, ${result.summary.reviews} відгуків. Наявні записи збережено.`);
    return result;
  }finally{await db.end();}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  let runtime;
  try{const {catalogDatabase}=await import('./catalog.mjs');runtime=await catalogDatabase();const result=await seedDemoDatabase(runtime.config);console.log(result.applied?'Демонстраційний набір додано.':'Демонстраційний набір уже додано або вимкнено. Повторних записів немає.');}
  catch(error){console.error(error instanceof Error?error.message:'Не вдалося додати демонстраційні дані');process.exitCode=1;}
  finally{runtime?.stop();}
}
