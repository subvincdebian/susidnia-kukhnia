import { loginDemo } from './auth-helpers.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { forDatabase } from '../scripts/runtime.mjs';
import { localDatabase } from '../scripts/database.mjs';
import { migrate, connectionString } from '../scripts/migrations.mjs';
import { createApplication } from '../apps/backend/dist/application.js';
import { OrdersService } from '../apps/backend/dist/orders/orders.service.js';
import { RestaurantsService } from '../apps/backend/dist/restaurants/restaurants.service.js';
import { GeoService, queryCoordinates } from '../apps/backend/dist/geo/geo.service.js';
import { mapTileConfiguration } from '../apps/backend/dist/geo/map-tiles.js';
import {appendLocations} from '../scripts/locations.mjs';

let runtime, admin, pool, app, orders, restaurants, base, cookie, dish, customer;
const database = `delivery_test_${process.pid}_${Date.now()}`;
let sequence = 0;
before(async () => {
  runtime = await localDatabase({test:true});
  admin = new pg.Client(forDatabase(runtime.config,'postgres'));
  await admin.connect();
  await admin.query(`CREATE DATABASE ${database}`);
  const config = forDatabase(runtime.config,database);
  await migrate(config);
  pool = new pg.Pool({...config,max:8});
  dish = (await pool.query('SELECT m.id,m.restaurant_id,m.price::text FROM menu_items m JOIN restaurants r ON r.id=m.restaurant_id WHERE m.is_available AND r.is_active ORDER BY m.id LIMIT 1')).rows[0];
  customer = (await pool.query('SELECT id FROM customers ORDER BY id LIMIT 1')).rows[0].id;
  app = await createApplication({connectionString:connectionString(config)});
  await app.listen(0,'127.0.0.1');
  orders = app.get(OrdersService);
  restaurants = app.get(RestaurantsService);
  base = await app.getUrl();
  cookie = (await loginDemo(base,config)).cookie;
});
after(async () => {
  if (app) await app.close();
  if (pool) await pool.end();
  if (admin) {
    if (/^delivery_test_\d+_\d+$/.test(database)) await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    await admin.end();
  }
  runtime?.stop();
});
const checkout = input => orders.checkout(input,customer);
const draft = (extra={}) => ({customer_id:customer,restaurant_id:dish.restaurant_id,delivery_address:'Демонстраційна адреса, 1',delivery_note:'',items:[{menu_item_id:dish.id,quantity:1}],...extra});
const checkoutDraft = (extra={}) => {
  sequence++;
  return {...draft(),request_key:createHash('sha256').update('delivery-checkout-'+sequence).digest('hex'),full_name:'Одержувач доставки',phone:'+380000'+String(sequence).padStart(6,'0'),payment_method:'готівка',expected_total:Number(dish.price).toFixed(2),...extra};
};
const rejectStatus = (status) => (error) => error.status === status;
const availableCourier = async () => (await pool.query('SELECT id FROM couriers WHERE is_active AND is_available ORDER BY id LIMIT 1')).rows[0].id;
async function inRoad() {
  const row = await orders.create(draft());
  await orders.changeStatus(row.id,{status:'готується',expected_status:'створено'});
  const courier = await availableCourier();
  await orders.changeStatus(row.id,{status:'в дорозі',expected_status:'готується',courier_id:courier});
  return {id:row.id,courier};
}
const cancel = (id,status='в дорозі') => orders.changeStatus(id,{status:'скасовано',expected_status:status});

test('branch coordinates: repeated import preserves manual points and ignores edited addresses',async()=>{
  const key='coordinate-import-test';
  const restaurant=(await pool.query("INSERT INTO restaurants(name,address,phone,cuisine_type,catalog_key) VALUES ('Перевірка координат','Київ, контрольна адреса, 1','+380000000000','тест',$1) RETURNING id",[key])).rows[0].id;
  const locations={version:1,checked_at:'2026-11-02',restaurants:[{catalog_key:key,address:'Київ, контрольна адреса, 1',latitude:50.45,longitude:30.52,coordinate_source:'https://www.openstreetmap.org/node/1'}]};
  const client=await pool.connect();
  try {
    assert.equal(await appendLocations(client,locations),1);
    assert.equal(await appendLocations(client,locations),0);
    await pool.query('UPDATE restaurants SET latitude=50.46 WHERE id=$1',[restaurant]);
    assert.equal(await appendLocations(client,locations),0);
    assert.equal((await pool.query('SELECT latitude FROM restaurants WHERE id=$1',[restaurant])).rows[0].latitude,50.46);
    await pool.query("UPDATE restaurants SET address='Інша адреса',latitude=NULL,longitude=NULL,coordinate_source=NULL WHERE id=$1",[restaurant]);
    assert.equal(await appendLocations(client,locations),0);
    assert.equal((await pool.query('SELECT latitude FROM restaurants WHERE id=$1',[restaurant])).rows[0].latitude,null);
  } finally {client.release();await pool.query('DELETE FROM restaurants WHERE id=$1',[restaurant]);}
});

test('map migration: наявні замовлення, суми, статуси та координати збережені без вигаданої геолокації',async () => {
  assert.equal((await pool.query('SELECT COUNT(*) FROM orders')).rows[0].count,'12');
  assert.equal((await pool.query('SELECT SUM(total_amount)::text AS amount FROM orders')).rows[0].amount,'4180.00');
  assert.equal((await pool.query('SELECT COUNT(*) FROM orders WHERE address_version<>0 OR delivery_latitude IS NOT NULL OR delivery_longitude IS NOT NULL OR courier_latitude IS NOT NULL OR courier_longitude IS NOT NULL OR courier_location_at IS NOT NULL OR courier_location_source IS NOT NULL')).rows[0].count,'0');
  assert.equal((await pool.query('SELECT COUNT(*) FROM delivery_messages')).rows[0].count,'0');
  assert.equal((await pool.query("SELECT confdeltype FROM pg_constraint WHERE conrelid='delivery_messages'::regclass AND contype='f'")).rows[0].confdeltype,'r');
});

test('map API: повертає всі заклади понад розмір сторінки, закриті та відсутні координати явно',async () => {
  await pool.query("INSERT INTO restaurants(name,address,phone,cuisine_type,is_active) SELECT 'Тест карти '||n,'Адреса карти '||n,'+380000000000','тест',n<>1 FROM generate_series(1,12) n");
  const first = (await pool.query("SELECT id FROM restaurants WHERE name='Тест карти 1'")).rows[0].id;
  await pool.query("UPDATE restaurants SET latitude=50.45,longitude=30.52,coordinate_source='https://www.openstreetmap.org/node/123' WHERE id=$1",[first]);
  const response = await fetch(base+'/api/restaurants/map',{headers:{cookie}});
  assert.equal(response.status,200);
  const page = await response.json();
  assert(page.items.length>10);
  assert.equal(page.items.length,page.total);
  assert.equal(page.truncated,false);
  assert.equal(page.missing_coordinates,page.items.filter((item)=>item.latitude===null).length);
  const inactive = page.items.find((item)=>item.id===first);
  assert.equal(inactive.is_active,false);
  assert.equal(inactive.latitude,50.45);
  assert.equal(inactive.longitude,30.52);
  await restaurants.save(first,{name:inactive.name,address:'Нова адреса карти',phone:inactive.phone,cuisine_type:inactive.cuisine_type,is_active:false});
  const changed = await restaurants.get(first);
  assert.equal(changed.latitude,null);
  assert.equal(changed.longitude,null);
  assert.equal(changed.coordinate_source,null);
});

test('coordinates: старе оформлення сумісне, нова пара перевіряється без рядків, NaN і неповних координат',async () => {
  const legacy = await orders.create(draft());
  assert.equal(legacy.delivery_latitude,null);
  assert.equal(legacy.delivery_longitude,null);
  assert.equal(legacy.address_version,0);
  const created = await orders.create(draft({delivery_latitude:50.4501,delivery_longitude:30.5234}));
  const detail = await orders.get(created.id);
  assert.equal(detail.delivery_latitude,50.4501);
  assert.equal(detail.delivery_longitude,30.5234);
  assert.equal(typeof detail.restaurant_address,'string');
  assert.equal(typeof detail.restaurant_phone,'string');
  assert.equal(detail.courier_phone,null);
  for (const pair of [
    {delivery_latitude:50}, {delivery_longitude:30},
    {delivery_latitude:'50',delivery_longitude:30},
    {delivery_latitude:NaN,delivery_longitude:30},
    {delivery_latitude:50,delivery_longitude:Infinity},
    {delivery_latitude:91,delivery_longitude:30},
    {delivery_latitude:50,delivery_longitude:-181},
    {delivery_latitude:null,delivery_longitude:null},
  ]) await assert.rejects(async()=>orders.create(draft(pair)),rejectStatus(400));
  await assert.rejects(pool.query('UPDATE orders SET delivery_latitude=50,address_version=1 WHERE id=$1',[legacy.id]),(error)=>error.code==='23514');
});

test('checkout: хеш до міграції не змінюється без координат, нові координати входять у ключ повтору',async () => {
  const input = checkoutDraft({expected_total:'10.00'});
  const oldPayload = {
    fullName:input.full_name,phone:input.phone,expectedTotal:input.expected_total,
    restaurant:input.restaurant_id,address:input.delivery_address,note:'',paymentMethod:'готівка',
    items:[{id:dish.id,quantity:1}],
  };
  const hash = createHash('sha256').update(JSON.stringify(oldPayload)).digest('hex');
  await pool.query('INSERT INTO _checkout_requests(request_key,request_hash,order_id) VALUES($1,$2,1)',[input.request_key,hash]);
  assert.deepEqual(await checkout(input),{id:1});
  await assert.rejects(checkout({...input,delivery_latitude:50.45,delivery_longitude:30.52}),rejectStatus(409));
  const positioned = checkoutDraft({delivery_latitude:50.451,delivery_longitude:30.524});
  const first = await checkout(positioned);
  assert.deepEqual(await checkout(positioned),first);
  assert.equal((await orders.get(first.id)).delivery_latitude,50.451);
  await assert.rejects(checkout({...positioned,delivery_longitude:30.525}),rejectStatus(409));
});

test('address: створено й готується, версія захищає від втрати змін, текст без позиції очищає старі координати',async () => {
  const initial = await orders.create(draft({delivery_latitude:50.45,delivery_longitude:30.52}));
  const before = await orders.get(initial.id);
  const changed = await orders.changeAddress(initial.id,{expected_version:0,delivery_address:'Інша адреса',delivery_latitude:50.46,delivery_longitude:30.53});
  assert.equal(changed.address_version,1);
  await assert.rejects(orders.changeAddress(initial.id,{expected_version:0,delivery_address:'Застаріла адреса'}),rejectStatus(409));
  await orders.changeStatus(initial.id,{status:'готується',expected_status:'створено'});
  const cleared = await orders.changeAddress(initial.id,{expected_version:1,delivery_address:'Адреса введена вручну'});
  assert.equal(cleared.delivery_latitude,null);
  assert.equal(cleared.delivery_longitude,null);
  assert.equal(cleared.address_version,2);
  const after = await orders.get(initial.id);
  assert.equal(after.total_amount.toFixed(2),before.total_amount.toFixed(2));
  assert.equal(after.customer_id,before.customer_id);
  assert.equal(after.restaurant_id,before.restaurant_id);
  const competing = await Promise.allSettled([
    orders.changeAddress(initial.id,{expected_version:2,delivery_address:'Одночасна адреса А'}),
    orders.changeAddress(initial.id,{expected_version:2,delivery_address:'Одночасна адреса Б'}),
  ]);
  assert.equal(competing.filter((item)=>item.status==='fulfilled').length,1);
  assert.equal(competing.find((item)=>item.status==='rejected').reason.status,409);
  await cancel(initial.id,'готується');
  await assert.rejects(orders.changeAddress(initial.id,{expected_version:3,delivery_address:'Завершено'}),rejectStatus(409));
});

async function waitForLocks(count) {
  const deadline = Date.now()+5000;
  while (Date.now()<deadline) {
    const result = await pool.query("SELECT COUNT(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM orders WHERE id=%FOR UPDATE%'");
    if (Number(result.rows[0].count)>=count) return;
    await new Promise((resolve)=>setTimeout(resolve,15));
  }
  assert.fail('Не дочекалися конкурентного блокування рядка замовлення');
}
test('address/pickup race: призначення кур’єра та зміна адреси блокують той самий рядок',async () => {
  const order = await orders.create(draft());
  await orders.changeStatus(order.id,{status:'готується',expected_status:'створено'});
  const courier = await availableCourier();
  const blocker = await pool.connect();
  let outcomes;
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM orders WHERE id=$1 FOR UPDATE',[order.id]);
    const pickup = orders.changeStatus(order.id,{status:'в дорозі',expected_status:'готується',courier_id:courier});
    await waitForLocks(1);
    const address = orders.changeAddress(order.id,{expected_version:0,delivery_address:'Надто пізня адреса'});
    outcomes = Promise.allSettled([pickup,address]);
    await waitForLocks(2);
    await blocker.query('COMMIT');
    const [picked,edited] = await outcomes;
    assert.equal(picked.status,'fulfilled');
    assert.equal(edited.status,'rejected');
    assert.equal(edited.reason.status,409);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    if (outcomes) await outcomes;
  }
  const current = await orders.get(order.id);
  assert.equal(current.address_version,0);
  assert.equal(current.delivery_address,'Демонстраційна адреса, 1');
  await cancel(order.id);
});

test('courier position: лише призначений кур’єр у дорозі, справжнє джерело, завершена доставка зберігає останню позицію',async () => {
  const initial = await orders.create(draft());
  const courier = await availableCourier();
  await assert.rejects(orders.updateCourierLocation(initial.id,{courier_id:courier,latitude:50.45,longitude:30.52,source:'gps'}),rejectStatus(409));
  const current = await inRoad();
  assert.equal((await orders.get(current.id)).courier_latitude,null);
  await assert.rejects(orders.updateCourierLocation(current.id,{courier_id:2147483647,latitude:50.45,longitude:30.52,source:'gps'}),rejectStatus(409));
  await assert.rejects(async()=>orders.updateCourierLocation(current.id,{courier_id:current.courier,latitude:50.45,longitude:30.52,source:'simulated'}),rejectStatus(400));
  const gps = await orders.updateCourierLocation(current.id,{courier_id:current.courier,latitude:50.45,longitude:30.52,source:'gps'});
  assert.equal(gps.courier_location_source,'gps');
  assert(gps.courier_location_at instanceof Date);
  assert.equal(gps.courier_latitude,50.45);
  await assert.rejects(pool.query('UPDATE orders SET courier_location_source=NULL WHERE id=$1',[current.id]),(error)=>error.code==='23514');
  const manual = await orders.updateCourierLocation(current.id,{courier_id:current.courier,latitude:50.451,longitude:30.521,source:'manual'});
  assert.equal(manual.courier_location_source,'manual');
  await cancel(current.id);
  await assert.rejects(orders.updateCourierLocation(current.id,{courier_id:current.courier,latitude:50.46,longitude:30.53,source:'gps'}),rejectStatus(409));
  assert.equal((await orders.get(current.id)).courier_latitude,50.451);
});

test('messages: після pickup, перевірка кур’єра, атомарні повтори та незмінна історія після завершення',async () => {
  const initial = await orders.create(draft());
  const message = {sender:'customer',body:'Будь ласка, зателефонуйте біля входу',request_key:'message-retry-1'};
  await assert.rejects(orders.sendMessage(initial.id,message),rejectStatus(409));
  const current = await inRoad();
  await assert.rejects(async()=>orders.sendMessage(current.id,{...message,sender:'courier'}),rejectStatus(400));
  await assert.rejects(orders.sendMessage(current.id,{...message,sender:'courier',courier_id:2147483647}),rejectStatus(409));
  const repeated = await Promise.all([orders.sendMessage(current.id,message),orders.sendMessage(current.id,message),orders.sendMessage(current.id,message)]);
  assert.equal(new Set(repeated.map((item)=>item.id)).size,1);
  await assert.rejects(orders.sendMessage(current.id,{...message,body:'Інший текст'}),rejectStatus(409));
  await assert.rejects(orders.sendMessage(current.id,{...message,sender:'courier',courier_id:current.courier}),rejectStatus(409));
  const answer = await orders.sendMessage(current.id,{sender:'courier',courier_id:current.courier,body:'Добре, зателефоную',request_key:'courier-answer-1'});
  assert.equal(answer.sender,'courier');
  for (const input of [{...message,body:' '},{...message,body:'a'.repeat(1001)},{...message,sender:'operator'},{...message,request_key:'bad key!'}])
    await assert.rejects(async()=>orders.sendMessage(current.id,input),rejectStatus(400));
  await assert.rejects(pool.query('UPDATE delivery_messages SET body=$2 WHERE id=$1',[answer.id,'Змінений текст']),(error)=>error.code==='23514');
  await assert.rejects(pool.query('DELETE FROM delivery_messages WHERE id=$1',[answer.id]),(error)=>error.code==='23514');
  await cancel(current.id);
  assert.equal((await orders.sendMessage(current.id,message)).id,repeated[0].id);
  await assert.rejects(orders.sendMessage(current.id,{...message,request_key:'after-completion-1'}),rejectStatus(409));
  const history = await orders.messages(current.id);
  assert.deepEqual(history.items.map((item)=>item.id),[repeated[0].id,answer.id]);
  assert.equal(history.has_more,false);
});

test('messages: останні 100 у хронологічному порядку та явна наявність старішої історії',async () => {
  const current = await inRoad();
  await pool.query("INSERT INTO delivery_messages(order_id,sender,body,request_key) SELECT $1,'customer','Повідомлення '||n,'history-key-'||n FROM generate_series(1,103) n",[current.id]);
  const result = await orders.messages(current.id);
  assert.equal(result.items.length,100);
  assert.equal(result.has_more,true);
  assert.equal(result.items[0].body,'Повідомлення 4');
  assert.equal(result.items.at(-1).body,'Повідомлення 103');
  assert.deepEqual(result.items.map((item)=>item.id),result.items.map((item)=>item.id).toSorted((a,b)=>a-b));
  await cancel(current.id);
});

test('new HTTP endpoints: локальний сеанс й Origin перевіряються окремо від полів',async () => {
  const current = await orders.create(draft());
  const path = `/api/orders/${current.id}/address`;
  const request = (headers,body) => fetch(base+path,{method:'PATCH',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  const input = {expected_version:0,delivery_address:'Нова адреса HTTP'};
  assert.equal((await request({},input)).status,401);
  assert.equal((await request({cookie},input)).status,403);
  assert.equal((await request({cookie,Origin:base},{...input,expected_version:-1})).status,400);
  assert.equal((await request({cookie,Origin:base},input)).status,200);
  for (const path of ['/api/restaurants/map',`/api/orders/${current.id}/messages`,'/api/geo/search?q=Київ'])
    assert.equal((await fetch(base+path)).status,401);
  assert.equal((await fetch(base+'/api/geo/reverse?latitude=NaN&longitude=30',{headers:{cookie}})).status,400);
  assert.equal((await fetch(base+'/api/geo/route?from_latitude=50&from_longitude=30&to_latitude=&to_longitude=30',{headers:{cookie}})).status,400);
  assert.equal((await fetch(base+'/api/geo/search?q=ab',{headers:{cookie}})).status,400);
});

test('address form: ручне редагування надсилає сумісний HTTP-запит і очищає колишню точку',async () => {
  const {addressUpdate} = await import('../apps/web/src/features/delivery-tracking/model.ts');
  const current = await orders.create(draft({delivery_latitude:50.45,delivery_longitude:30.52}));
  const response = await fetch(base+`/api/orders/${current.id}/address`,{
    method:'PATCH',headers:{'Content-Type':'application/json',cookie,Origin:base},
    body:JSON.stringify(addressUpdate('Нова адреса без карти',0,null)),
  });
  assert.equal(response.status,200);
  const saved=await orders.get(current.id);
  assert.equal(saved.delivery_address,'Нова адреса без карти');
  assert.equal(saved.delivery_latitude,null);
  assert.equal(saved.delivery_longitude,null);
  assert.equal(saved.address_version,1);
});

test('courier delivery: поточне замовлення, відсутність доставки й захищений локальний доступ',async () => {
  const current = await inRoad();
  const url = base+`/api/couriers/${current.courier}/delivery`;
  assert.equal((await fetch(url)).status,401);
  const response = await fetch(url,{headers:{cookie}});
  assert.equal(response.status,200);
  const result = await response.json();
  assert.equal(result.order_id,current.id);
  assert.equal(result.courier.id,current.courier);
  assert.equal(typeof result.courier.vehicle_type,'string');
  assert.equal((await orders.get(current.id)).courier_transport,result.courier.vehicle_type);
  await cancel(current.id);
  assert.equal((await (await fetch(url,{headers:{cookie}})).json()).order_id,null);
  assert.equal((await fetch(base+'/api/couriers/2147483647/delivery',{headers:{cookie}})).status,404);
});

test('map tiles: локальна конфігурація, HTTPS шаблон, точний CSP origin і Referer для атрибуції провайдера',async () => {
  assert.equal((await fetch(base+'/api/geo/config')).status,401);
  const response = await fetch(base+'/api/geo/config',{headers:{cookie}});
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{tile_url:'https://tile.openstreetmap.org/{z}/{x}/{y}.png'});
  assert.equal(response.headers.get('referrer-policy'),'strict-origin-when-cross-origin');
  assert.match(response.headers.get('content-security-policy'),/img-src 'self' data: https:\/\/tile\.openstreetmap\.org;/);
  assert.match(response.headers.get('content-security-policy'),/connect-src 'self';/);
  const previous = process.env.DELIVERY_MAP_TILE_URL;
  try {
    process.env.DELIVERY_MAP_TILE_URL='https://tiles.example.invalid/dark/{z}/{x}/{y}.png';
    assert.deepEqual(mapTileConfiguration(),{tile_url:process.env.DELIVERY_MAP_TILE_URL,tile_origin:'https://tiles.example.invalid'});
    assert.deepEqual(new GeoService().configuration(),{tile_url:process.env.DELIVERY_MAP_TILE_URL});
    for (const template of ['http://tiles.example.invalid/{z}/{x}/{y}.png','https://user:secret@example.test/{z}/{x}/{y}.png','https://tiles.example.invalid/{z}/{x}.png','https://tiles.example.invalid/{z}/{x}/{y}.png?key=secret','https://{z}.example.invalid/{x}/{y}.png']) {
      process.env.DELIVERY_MAP_TILE_URL=template;
      assert.throws(()=>mapTileConfiguration(),(error)=>!/secret|user@/.test(error.message));
    }
  } finally {
    if (previous===undefined) delete process.env.DELIVERY_MAP_TILE_URL;
    else process.env.DELIVERY_MAP_TILE_URL=previous;
  }
});

const photonFeature = {type:'Feature',geometry:{type:'Point',coordinates:[30.5234,50.4501]},properties:{osm_type:'N',osm_id:123,name:'Майдан Незалежності',city:'Київ',country:'Україна'}};
const jsonResponse = (value) => new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
test('geo: Photon/OSRM відповіді, дедуплікація, кеш, порядок lon/lat та спільний ліміт geocoding',async (t) => {
  const calls = [];
  t.mock.method(globalThis,'fetch',async (input) => {
    const url = new URL(input);
    calls.push({url,at:Date.now()});
    if (url.hostname==='router.project-osrm.org') return jsonResponse({code:'Ok',routes:[{geometry:{type:'LineString',coordinates:[[30.52,50.45],[30.5234,50.4501]]},distance:850,duration:210}]});
    return jsonResponse({features:[photonFeature]});
  });
  const geo = new GeoService(), second = new GeoService();
  const [first,repeated,reversed] = await Promise.all([
    geo.search('  Київ Майдан  '),geo.search('Київ Майдан'),
    second.reverse({latitude:50.45011,longitude:30.52341}),
  ]);
  assert.deepEqual(first,repeated);
  assert.equal(calls.length,2);
  assert(calls[1].at-calls[0].at>=900);
  assert.equal(first.items[0].source_url,'https://www.openstreetmap.org/node/123');
  assert.equal(first.items[0].latitude,50.4501);
  assert.equal(first.items[0].longitude,30.5234);
  assert.equal(reversed.place.id,'node/123');
  assert.equal(calls[0].url.searchParams.get('countrycode'),'UA');
  assert.equal(calls[0].url.searchParams.get('limit'),'5');
  assert.equal(calls[1].url.searchParams.get('radius'),'0.2');
  await geo.search('київ майдан');
  assert.equal(calls.length,2);
  const route = await geo.route({latitude:50.45,longitude:30.52},{latitude:50.4501,longitude:30.5234});
  assert.deepEqual(route,{coordinates:[[30.52,50.45],[30.5234,50.4501]],distance_meters:850,duration_seconds:210,source:'OSRM'});
  assert.equal(calls[2].url.pathname,'/route/v1/driving/30.52,50.45;30.5234,50.4501');
  await geo.route({latitude:50.45,longitude:30.52},{latitude:50.4501,longitude:30.5234});
  assert.equal(calls.length,3);
  await geo.search('https://example.invalid/private');
  assert.equal(calls.at(-1).url.hostname,'photon.komoot.io');
});

test('geo: порожній результат і NoRoute відрізняються від тимчасової помилки, секрети не повертаються',async (t) => {
  t.mock.method(globalThis,'fetch',async (input) => {
    const url = new URL(input);
    return url.hostname==='router.project-osrm.org' ? jsonResponse({code:'NoRoute',routes:[]}) : jsonResponse({features:[]});
  });
  const geo = new GeoService();
  assert.deepEqual(await geo.search('Адреси не існує'),{items:[]});
  assert.deepEqual(await geo.reverse({latitude:0,longitude:0}),{place:null});
  await assert.rejects(geo.route({latitude:0,longitude:0},{latitude:1,longitude:1}),rejectStatus(404));
  t.mock.method(globalThis,'fetch',async () => {throw new Error('postgres://provider:secret@example.test/private-address');});
  await assert.rejects(geo.search('Інша невідома адреса'),(error)=>error.status===503&&!/secret|postgres|provider/.test(error.message));
  const nativeFetch = t.mock.method(globalThis,'fetch',async () => jsonResponse({code:'Ok',routes:[{geometry:{type:'LineString',coordinates:[[30,50],['bad',50]]},distance:1,duration:1}]}));
  await assert.rejects(geo.route({latitude:2,longitude:2},{latitude:3,longitude:3}),rejectStatus(503));
  nativeFetch.mock.restore();
});

test('geo: обмежений розмір відповіді, жорсткий timeout та перевірка конфігурації HTTPS',async (t) => {
  t.mock.method(globalThis,'fetch',async () => new Response('x'.repeat(2*1024*1024+1)));
  const geo = new GeoService();
  await assert.rejects(geo.search('Завелика відповідь'),rejectStatus(503));
  let aborted = false;
  t.mock.method(globalThis,'fetch',(_input,options)=>new Promise((_resolve,reject)=>{
    options.signal.addEventListener('abort',()=>{aborted=true;reject(new Error('aborted'));},{once:true});
  }));
  await assert.rejects(geo.route({latitude:4,longitude:4},{latitude:5,longitude:5}),rejectStatus(503));
  assert.equal(aborted,true);
  const previous = process.env.DELIVERY_PHOTON_URL;
  try {
    process.env.DELIVERY_PHOTON_URL='http://user:secret@example.test/';
    assert.throws(()=>new GeoService(),(error)=>!/secret|user@/.test(error.message)&&/HTTPS/.test(error.message));
  } finally {
    if (previous===undefined) delete process.env.DELIVERY_PHOTON_URL;
    else process.env.DELIVERY_PHOTON_URL=previous;
  }
  for (const input of [{latitude:'',longitude:'30'},{latitude:['50'],longitude:'30'},{latitude:'Infinity',longitude:'30'},{latitude:'50',longitude:'181'}])
    assert.throws(()=>queryCoordinates(input),rejectStatus(400));
});
