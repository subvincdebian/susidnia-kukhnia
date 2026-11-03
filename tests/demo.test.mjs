import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import {localDatabase,root} from '../scripts/database.mjs';
import {forDatabase} from '../scripts/runtime.mjs';
import {migrate} from '../scripts/migrations.mjs';
import {importEmptyCatalog} from '../scripts/catalog.mjs';
import {applyDemoData,validateDemo} from '../scripts/demo.mjs';
const name=`delivery_test_${process.pid}_${Date.now()}`;
const demo=JSON.parse(await fs.readFile(path.join(root,'data/demo.json'),'utf8'));
const catalog=JSON.parse(await fs.readFile(path.join(root,'data/catalog.json'),'utf8'));
const tables=['restaurants','menu_items','customers','couriers','orders','order_items','reviews','payments'];
let runtime,admin,db,config,initial,summary;
const snapshot=async(sequences=false)=>{
  const result={};for(const table of [...tables,'_app_data_seeds'])result[table]=(await db.query(`SELECT * FROM ${table} ORDER BY ${table==='_app_data_seeds'?'name':'id'}`)).rows;
  if(sequences)for(const table of tables)result[table+'_seq']=(await db.query(`SELECT last_value,is_called FROM ${table}_id_seq`)).rows;
  return result;
};
before(async()=>{
  runtime=await localDatabase({test:true});admin=new pg.Client(forDatabase(runtime.config,'postgres'));await admin.connect();await admin.query(`CREATE DATABASE ${name}`);
  config=forDatabase(runtime.config,name);db=new pg.Client(config);await db.connect();await db.query(await fs.readFile(path.join(root,'db/catalog-schema.sql'),'utf8'));await migrate(config);await importEmptyCatalog(db,catalog);
  const {rows:[customer]}=await db.query("INSERT INTO customers(full_name,email,phone,default_delivery_address,created_at) VALUES('Наявний клієнт',$1,'+380000001111','Наявна адреса','2026-09-01') RETURNING id",[demo.customers[0].email]);
  await db.query("INSERT INTO couriers(full_name,phone,vehicle_type) VALUES('Наявний кур’єр','+380000001222','велосипед')");
  const {rows:[dish]}=await db.query('SELECT id,restaurant_id,price FROM menu_items ORDER BY id LIMIT 1');
  const {rows:[order]}=await db.query("INSERT INTO orders(customer_id,restaurant_id,delivery_address,delivery_note) VALUES($1,$2,'Наявна адреса','Наявне замовлення') RETURNING id",[customer.id,dish.restaurant_id]);
  await db.query('INSERT INTO order_items(order_id,menu_item_id,quantity,unit_price) VALUES($1,$2,1,$3)',[order.id,dish.id,dish.price]);
  initial=await snapshot();
});
after(async()=>{await db?.end();if(admin){await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);await admin.end();}runtime?.stop();});

test('Демонстраційний набір перевіряє посилання, кількості й конфлікти активних кур’єрів',()=>{
  validateDemo(demo);
  const broken=structuredClone(demo);broken.orders.find(o=>o.status==='в дорозі').courier='відсутній';assert.throws(()=>validateDemo(broken),/Некоректний набір/);
  const duplicate=structuredClone(demo),active=duplicate.orders.filter(o=>o.status==='в дорозі');active[1].courier=active[0].courier;assert.throws(()=>validateDemo(duplicate),/Некоректний набір/);
});
test('Два одночасні запуски додають один набір і зберігають наявні дані',async()=>{
  const a=new pg.Client(config),b=new pg.Client(config);await a.connect();await b.connect();
  let results;try{results=await Promise.all([applyDemoData(a,demo),applyDemoData(b,demo)]);}finally{await a.end();await b.end();}
  assert.deepEqual(results.map(r=>r.applied).sort(),[false,true]);summary=results.find(r=>r.applied).summary;
  assert.deepEqual([summary.customers,summary.added_customers,summary.couriers,summary.orders,summary.order_items,summary.payments,summary.reviews],[12,11,10,30,60,20,16]);
  const current=await snapshot();
  for(const table of tables)assert.deepEqual(current[table].filter(r=>initial[table].some(old=>old.id===r.id)),initial[table],table);
  assert.equal(current._app_data_seeds.length,1);assert.equal(current.orders.length,31);assert.equal(current.order_items.length,61);
});
test('Суми, історичні ціни, оплати й зайнятість кур’єрів узгоджені',async()=>{
  assert.equal((await db.query("SELECT COUNT(*) FROM orders o WHERE o.total_amount<>(SELECT COALESCE(SUM(i.quantity*i.unit_price),0) FROM order_items i WHERE i.order_id=o.id)")).rows[0].count,'0');
  assert.equal((await db.query("SELECT COUNT(*) FROM orders o LEFT JOIN payments p ON p.order_id=o.id WHERE (o.delivery_status='доставлено' AND (p.id IS NULL OR p.amount<>o.total_amount)) OR (o.delivery_status<>'доставлено' AND p.id IS NOT NULL)")).rows[0].count,'0');
  assert.equal((await db.query("SELECT COUNT(*) FROM couriers c WHERE c.is_available=EXISTS(SELECT 1 FROM orders o WHERE o.courier_id=c.id AND o.delivery_status='в дорозі')")).rows[0].count,'0');
  assert.equal((await db.query('SELECT COUNT(*) FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.paid_at<>o.order_date+INTERVAL \'45 minutes\'')).rows[0].count,'0');
  assert.equal((await db.query('SELECT COUNT(*) FROM reviews v JOIN orders o ON o.id=v.order_id JOIN payments p ON p.order_id=o.id WHERE v.created_at<p.paid_at')).rows[0].count,'0');
  assert.equal((await db.query('SELECT COUNT(*) FROM orders o JOIN customers c ON c.id=o.customer_id WHERE o.order_date<c.created_at')).rows[0].count,'0');
  const historical=(await db.query('SELECT i.unit_price,m.price FROM order_items i JOIN menu_items m ON m.id=i.menu_item_id WHERE i.order_id=$1 AND i.unit_price<>m.price',[summary.order_ids['order-16']])).rows;
  assert.deepEqual(historical,[{unit_price:'149.00',price:'159.00'}]);
  assert.equal((await db.query("SELECT COUNT(DISTINCT method) FROM payments")).rows[0].count,'2');
  assert.deepEqual(Object.fromEntries(summary.statuses.map(r=>[r.delivery_status,r.count])),{'доставлено':20,'створено':3,'готується':3,'в дорозі':2,'скасовано':2});
  assert.equal(summary.total_amount,'16758.06');assert.equal(summary.delivered_amount,'9500.00');
  assert.equal((await db.query('SELECT total_amount FROM orders WHERE id=$1',[summary.order_ids['order-21']])).rows[0].total_amount,'318.00');
});
test('Повторний запуск не відновлює видалені чи вручну змінені демонстраційні записи',async()=>{
  await db.query('UPDATE customers SET full_name=$1 WHERE email=$2',['Змінене ім’я',demo.customers[1].email]);
  await db.query('UPDATE orders SET delivery_note=$1 WHERE id=$2',['Нова примітка',summary.order_ids['order-21']]);
  await db.query('DELETE FROM reviews WHERE order_id=$1',[summary.order_ids['order-01']]);
  const before=await snapshot(true),result=await applyDemoData(db,demo);assert.equal(result.applied,false);assert.deepEqual(await snapshot(true),before);
  const changed=structuredClone(demo);changed.customers[0].name='Інше ім’я';await assert.rejects(applyDemoData(db,changed),/іншим вмістом/);assert.deepEqual(await snapshot(true),before);
});
test('Помилка після історичних оплат відкочує весь новий набір і запис про застосування',async()=>{
  const broken=structuredClone(demo);broken.version='rollback-demo';
  broken.customers.forEach((c,i)=>{c.email=`rollback${i}@example.test`;c.phone=`+380000008${String(100+i).padStart(3,'0')}`;});
  broken.couriers.forEach((c,i)=>{c.phone=`+380000009${String(100+i).padStart(3,'0')}`;});
  broken.orders.findLast(o=>o.review).review.comment+='\0';
  const before=await snapshot();await assert.rejects(applyDemoData(db,broken));assert.deepEqual(await snapshot(),before);
});
test('На демонстраційному замовленні показано ROLLBACK і повторне завершення без другої оплати',async()=>{
  const before=await snapshot(),active=summary.order_ids['order-28'];
  await db.query('BEGIN');await db.query("SELECT complete_order($1,'картка')",[active]);assert.equal((await db.query('SELECT delivery_status FROM orders WHERE id=$1',[active])).rows[0].delivery_status,'доставлено');await db.query('ROLLBACK');assert.deepEqual(await snapshot(),before);
  const completed=summary.order_ids['order-02'],payment=(await db.query('SELECT id FROM payments WHERE order_id=$1',[completed])).rows[0].id;
  assert.equal((await db.query("SELECT complete_order($1,'готівка') AS id",[completed])).rows[0].id,payment);assert.deepEqual(await snapshot(),before);
});
