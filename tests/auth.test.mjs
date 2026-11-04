import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {localDatabase} from '../scripts/database.mjs';
import {forDatabase} from '../scripts/runtime.mjs';
import {migrate,connectionString} from '../scripts/migrations.mjs';
import {seedAuthDatabase,demoAccounts} from '../scripts/auth.mjs';
import {createApplication} from '../apps/backend/dist/application.js';
import {OrdersService} from '../apps/backend/dist/orders/orders.service.js';
import {loginDemo} from './auth-helpers.mjs';

let runtime,admin,pool,app,base,config,localCookie,operator,alice,bob,dish,orders,seedResults,originalRows,seededRows,legacyContacts;
const database = 'delivery_auth_test_'+process.pid+'_'+Date.now();
const businessTables=['restaurants','menu_items','customers','couriers','orders','order_items','reviews','payments','_checkout_requests','delivery_messages'];
const snapshot=async()=>{
  const rows={};for(const table of businessTables)rows[table]=(await pool.query('SELECT * FROM '+table+' ORDER BY '+(table==='_checkout_requests'?'request_key':'id'))).rows;return rows;
};
const query=(path,{cookie=localCookie,method='GET',body,origin=base,headers={}}={})=>fetch(base+'/api'+path,{method,headers:{...(cookie?{cookie}:{}),...(method==='GET'?{}:{Origin:origin,'Content-Type':'application/json'}),...headers},...(method==='GET'?{}:{body:JSON.stringify(body??{})})});
const login=(email,password)=>query('/auth/login',{method:'POST',body:{email,password}});
const read=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
before(async()=>{
  runtime=await localDatabase({test:true});admin=new pg.Client(forDatabase(runtime.config,'postgres'));await admin.connect();await admin.query('CREATE DATABASE '+database);
  config=forDatabase(runtime.config,database);await migrate(config);pool=new pg.Pool(config);
  legacyContacts=[];
  for(const account of demoAccounts){
    const {rows:[contact]}=await pool.query('INSERT INTO customers(full_name,email,phone,default_delivery_address) VALUES($1,$2,$3,$4) RETURNING *',['Наявний відвідувач '+account.role,account.email,account.phone,'Наявна адреса відвідувача']);
    legacyContacts.push(contact);
  }
  const previousDish=(await pool.query('SELECT id,restaurant_id,price FROM menu_items ORDER BY id LIMIT 1')).rows[0];
  const {rows:[legacyOrder]}=await pool.query('INSERT INTO orders(customer_id,restaurant_id,delivery_address) VALUES($1,$2,$3) RETURNING id',[legacyContacts[0].id,previousDish.restaurant_id,legacyContacts[0].default_delivery_address]);
  await pool.query('INSERT INTO order_items(order_id,menu_item_id,quantity,unit_price) VALUES($1,$2,1,$3)',[legacyOrder.id,previousDish.id,previousDish.price]);
  originalRows=await snapshot();seedResults=[await seedAuthDatabase(config),await seedAuthDatabase(config)];seededRows=await snapshot();
  app=await createApplication({connectionString:connectionString(config)});await app.listen(0,'127.0.0.1');base=await app.getUrl();
  localCookie=(await fetch(base+'/api/session')).headers.get('set-cookie').split(';')[0];
  operator=await loginDemo(base,config);alice=await loginDemo(base,config,{email:'user@demo.test',password:'UserDemo2026!'});
  const registration=await query('/auth/register',{method:'POST',body:{email:'second@demo.test',full_name:'Другий користувач',phone:'+380000000903',password:'SecondDemo2026!',role:'admin',id:operator.user.id,customer_id:operator.user.customer_id}});
  bob={cookie:localCookie+'; '+registration.headers.get('set-cookie').split(';')[0],user:(await read(registration)).user};
  orders=app.get(OrdersService);dish=(await pool.query('SELECT m.id,m.restaurant_id,m.price::text FROM menu_items m JOIN restaurants r ON r.id=m.restaurant_id WHERE m.is_available AND r.is_active ORDER BY m.id LIMIT 1')).rows[0];
});
after(async()=>{await app?.close();await pool?.end();if(admin){if(/^delivery_auth_test_\d+_\d+$/.test(database))await admin.query('DROP DATABASE '+database+' WITH (FORCE)');await admin.end();}runtime?.stop();});
const draft=(key,extra={})=>({request_key:createHash('sha256').update(key).digest('hex'),full_name:'Одержувач',phone:'+380000000904',restaurant_id:dish.restaurant_id,delivery_address:'Демонстраційна адреса, 2',delivery_note:'',payment_method:'готівка',expected_total:Number(dish.price).toFixed(2),items:[{menu_item_id:dish.id,quantity:1}],...extra});

test('auth seed: повтор зберігає всі попередні бізнес-записи й не переписує акаунти',async()=>{
  assert.deepEqual(seedResults,[{added:2},{added:0}]);
  for(const table of businessTables)assert.deepEqual(seededRows[table].filter(row=>originalRows[table].some(old=>(table==='_checkout_requests'?old.request_key===row.request_key:old.id===row.id))),originalRows[table],table);
  assert.equal(seededRows.customers.length-originalRows.customers.length,2);
  const account=(await pool.query('SELECT * FROM app_users WHERE email=$1',['user@demo.test'])).rows[0];
  assert.equal(account.role,'user');assert.match(account.password_hash,/^pbkdf2-sha256\$600000\$/);assert(!account.password_hash.includes('UserDemo2026!'));
  await pool.query("UPDATE app_users SET password_hash=$1,role='admin' WHERE id=$2",[account.password_hash+'changed',account.id]);
  try {await seedAuthDatabase(config);assert.deepEqual((await pool.query('SELECT password_hash,role FROM app_users WHERE id=$1',[account.id])).rows[0],{password_hash:account.password_hash+'changed',role:'admin'});}
  finally {await pool.query('UPDATE app_users SET password_hash=$1,role=$3 WHERE id=$2',[account.password_hash,account.id,account.role]);}
});

test('auth seed: колізії пошти й телефону створюють окремі контакти без привласнення історії',async()=>{
  for(const account of demoAccounts){
    const {rows:[seeded]}=await pool.query('SELECT u.customer_id,u.email,u.role,c.email AS contact_email,c.phone FROM app_users u JOIN customers c ON c.id=u.customer_id WHERE u.email=$1',[account.email]);
    assert.equal(seeded.email,account.email);assert.equal(seeded.role,account.role);
    assert.equal(seeded.contact_email,null);assert.match(seeded.phone,/^\+380000\d{6}$/);assert.notEqual(seeded.phone,account.phone);
    assert(!legacyContacts.some(contact=>contact.id===seeded.customer_id));
  }
  for(const contact of legacyContacts)assert.deepEqual((await pool.query('SELECT * FROM customers WHERE id=$1',[contact.id])).rows[0],contact);
  const rows=await snapshot(),accounts=(await pool.query('SELECT * FROM app_users ORDER BY id')).rows;
  assert.deepEqual(await seedAuthDatabase(config),{added:0});
  assert.deepEqual(await snapshot(),rows);assert.deepEqual((await pool.query('SELECT * FROM app_users ORDER BY id')).rows,accounts);
  for(const table of ['customers','orders','order_items'])assert.deepEqual(rows[table].filter(row=>originalRows[table].some(old=>old.id===row.id)),originalRows[table],table);
});

test('auth session: сервер визначає роль, гості бачать каталог без чужих контактів',async()=>{
  assert.deepEqual(await read(await query('/auth/session')),{user:null});
  assert.equal((await read(await query('/auth/session',{cookie:alice.cookie}))).user.id,alice.user.id);
  assert.equal(bob.user.role,'user');assert.notEqual(bob.user.customer_id,operator.user.customer_id);
  for(const cookie of [localCookie,alice.cookie]){const bootstrap=await read(await query('/bootstrap',{cookie}));assert.deepEqual(bootstrap.customers,[]);assert.deepEqual(bootstrap.couriers,[]);assert.deepEqual(bootstrap.counts,{});assert(bootstrap.restaurants.length>0);assert.equal((await query('/restaurants',{cookie})).status,200);}
  assert((await read(await query('/bootstrap',{cookie:operator.cookie}))).customers.length>0);
  for(const [method,path] of [['GET','/orders'],['GET','/customers'],['GET','/couriers'],['GET','/analytics'],['POST','/restaurants'],['POST','/menu'],['POST','/orders']]){
    assert.equal((await query(path,{method,body:{role:'admin'},cookie:localCookie})).status,401,path);
    assert.equal((await query(path,{method,body:{role:'admin',user_id:operator.user.id},cookie:alice.cookie,headers:{'x-role':'admin','x-user-id':String(operator.user.id)}})).status,403,path);
  }
  assert.equal((await query('/orders/checkout',{method:'POST',body:{}})).status,401);
  assert.equal((await query('/orders/checkout',{method:'POST',body:{},cookie:alice.cookie})).status,400);
});

test('auth login: неправильні дані відхилено, cookie HttpOnly, у БД лише хеш токена',async()=>{
  for(const [email,password] of [['user@demo.test','wrong'],['missing@demo.test','UserDemo2026!']]){
    const response=await login(email,password);assert.equal(response.status,401);assert.equal((await response.json()).message,'Неправильна пошта або пароль');assert.equal(response.headers.get('set-cookie'),null);
  }
  const response=await login(' USER@DEMO.TEST ','UserDemo2026!');const setCookie=response.headers.get('set-cookie');await read(response);
  assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/SameSite=Strict/);assert.match(setCookie,/Max-Age=28800/);
  const raw=setCookie.split(';')[0].split('=')[1];const hash=createHash('sha256').update(raw).digest('hex');
  const session=(await pool.query('SELECT * FROM auth_sessions WHERE token_hash=$1',[hash])).rows[0];assert(session);assert.notEqual(session.token_hash,raw);
  assert.deepEqual(await read(await query('/auth/session',{cookie:localCookie+'; auth_session=forged'})),{user:null});
});

test('auth registration: не можна привласнити існуючий контакт або створити роль admin',async()=>{
  const contact=(await pool.query('SELECT * FROM customers ORDER BY id LIMIT 1')).rows[0],before=await snapshot();
  const response=await query('/auth/register',{method:'POST',body:{email:'steal@demo.test',full_name:'Підміна',phone:contact.phone,password:'DifferentDemo2026!',role:'admin'}});
  assert.equal(response.status,409);assert.deepEqual(await snapshot(),before);
  assert.equal((await query('/auth/register',{method:'POST',body:{email:'bad',full_name:'Клієнт',phone:'+380000000905',password:'short'}})).status,400);
  assert.equal((await pool.query('SELECT COUNT(*) FROM app_users WHERE email=$1',['steal@demo.test'])).rows[0].count,'0');
});

test('checkout: акаунт і повтор запиту не можна підмінити телефоном, ID чи роллю',async()=>{
  const contact=(await pool.query('SELECT * FROM customers WHERE id=$1',[bob.user.customer_id])).rows[0];
  const input=draft('auth-checkout',{phone:contact.phone,customer_id:contact.id,user_id:operator.user.id,role:'admin'});
  const created=await read(await query('/orders/checkout',{method:'POST',body:input,cookie:alice.cookie}));
  assert.equal((await orders.get(created.id)).customer_id,alice.user.customer_id);
  assert.deepEqual((await pool.query('SELECT * FROM customers WHERE id=$1',[contact.id])).rows[0],contact);
  assert.deepEqual(await read(await query('/orders/checkout',{method:'POST',body:input,cookie:alice.cookie})),created);
  const replay=await query('/orders/checkout',{method:'POST',body:input,cookie:bob.cookie});assert.equal(replay.status,409);assert.equal((await replay.json()).id,undefined);
  const foreign=await read(await query('/orders/checkout',{method:'POST',body:draft('auth-second-checkout'),cookie:bob.cookie}));
  const recent=await read(await query('/orders/recent?ids='+created.id+','+foreign.id,{cookie:alice.cookie}));assert.deepEqual(recent.map(row=>row.id),[created.id]);
  assert.deepEqual((await read(await query('/orders/recent',{cookie:alice.cookie}))).map(row=>row.id),[created.id]);
  assert.deepEqual(await read(await query('/orders/recent',{cookie:operator.cookie})),[]);
  for(const [method,suffix,body] of [['GET','',undefined],['GET','/messages',undefined],['PATCH','/note',{}],['PATCH','/address',{}],['POST','/payment',{}],['POST','/messages',{}]])assert.equal((await query('/orders/'+created.id+suffix,{method,body,cookie:bob.cookie})).status,404,suffix);
  assert.equal((await query('/orders/'+created.id+'/status',{method:'PATCH',body:{},cookie:alice.cookie})).status,403);
  assert.equal((await query('/orders/'+created.id+'/courier-location',{method:'POST',body:{},cookie:alice.cookie})).status,403);
  assert.equal((await query('/orders/'+created.id+'/messages',{method:'POST',body:{sender:'courier',courier_id:1,body:'Підміна'},cookie:alice.cookie})).status,403);
  assert.equal((await query('/orders/'+created.id,{cookie:operator.cookie})).status,200);
});

test('reviews і чат: доступ лише до власного замовлення, admin керує доставкою',async()=>{
  const created=await orders.create({customer_id:alice.user.customer_id,restaurant_id:dish.restaurant_id,delivery_address:'Демонстраційна адреса',items:[{menu_item_id:dish.id,quantity:1}]});
  await orders.changeStatus(created.id,{status:'готується',expected_status:'створено'});
  const courier=(await pool.query('SELECT id FROM couriers WHERE is_active AND is_available ORDER BY id LIMIT 1')).rows[0].id;
  await orders.changeStatus(created.id,{status:'в дорозі',expected_status:'готується',courier_id:courier});
  const message={sender:'customer',body:'Власне повідомлення',request_key:'auth-message-own'};
  assert.equal((await query('/orders/'+created.id+'/messages',{method:'POST',body:message,cookie:alice.cookie})).status,200);
  assert.equal((await query('/orders/'+created.id+'/messages',{method:'POST',body:message,cookie:bob.cookie})).status,404);
  assert.equal((await query('/orders/'+created.id+'/messages',{method:'POST',body:{...message,sender:'courier',courier_id:courier,request_key:'auth-courier-message'},cookie:operator.cookie})).status,200);
  await orders.changeStatus(created.id,{status:'доставлено',expected_status:'в дорозі',payment_method:'готівка'});
  const options=await read(await query('/review-options',{cookie:alice.cookie}));assert(options.some(row=>row.id===created.id));assert(!(await read(await query('/review-options',{cookie:bob.cookie}))).some(row=>row.id===created.id));
  const body={order_id:created.id,rating:5,comment:'Власний відгук'};
  assert.equal((await query('/reviews',{method:'POST',body,cookie:bob.cookie})).status,404);
  const review=await read(await query('/reviews',{method:'POST',body,cookie:alice.cookie}));
  for(const method of ['PATCH','DELETE'])assert.equal((await query('/reviews/'+review.id,{method,body:{rating:1,comment:'Підміна'},cookie:bob.cookie})).status,404);
  assert((await read(await query('/reviews',{cookie:alice.cookie}))).items.some(row=>row.id===review.id));assert(!(await read(await query('/reviews',{cookie:bob.cookie}))).items.some(row=>row.id===review.id));
  assert.equal((await query('/reviews/'+review.id,{method:'PATCH',body:{rating:4,comment:'Оновлено'},cookie:alice.cookie})).status,200);
  assert.equal((await query('/reviews/'+review.id,{method:'DELETE',cookie:operator.cookie})).status,200);
});

test('logout і expiry відкликають токен; повторний login обертає старий токен',async()=>{
  const first=await login('user@demo.test','UserDemo2026!');await read(first);const cookie=localCookie+'; '+first.headers.get('set-cookie').split(';')[0];
  const rotated=await query('/auth/login',{method:'POST',body:{email:'user@demo.test',password:'UserDemo2026!'},cookie});await read(rotated);
  assert.equal((await query('/orders/recent',{cookie})).status,401);
  const next=localCookie+'; '+rotated.headers.get('set-cookie').split(';')[0];
  const logout=await query('/auth/logout',{method:'POST',cookie:next});assert.deepEqual(await read(logout),{ok:true});assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);assert.equal((await query('/orders/recent',{cookie:next})).status,401);
  const response=await login('user@demo.test','UserDemo2026!');await read(response);const expired=localCookie+'; '+response.headers.get('set-cookie').split(';')[0];const raw=response.headers.get('set-cookie').split(';')[0].split('=')[1];
  await pool.query("UPDATE auth_sessions SET created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' WHERE token_hash=$1",[createHash('sha256').update(raw).digest('hex')]);
  assert.deepEqual(await read(await query('/auth/session',{cookie:expired})),{user:null});assert.equal((await query('/orders/recent',{cookie:expired})).status,401);
});
