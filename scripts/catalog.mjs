import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { localDatabase, root } from './database.mjs';
import { migrate } from './migrations.mjs';
import { forDatabase } from './runtime.mjs';
import { readLocations, appendLocations } from './locations.mjs';

const targetName='food_delivery_catalog';
const state=path.join(root,'.local');
const selection=path.join(state,'active-database.json');

export function validateCatalog(catalog) {
  if(catalog?.version!==1||!/^\d{4}-\d{2}-\d{2}$/.test(catalog.checked_at)||!Array.isArray(catalog.restaurants)||!catalog.restaurants.length)throw new Error('Некоректний каталог');
  const string=(value,max=200)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
  const url=value=>{try{return new URL(value).protocol==='https:';}catch{return false;}};
  const photo=value=>typeof value==='string'&&/^\/media\/catalog\/[a-f0-9]{20}\.webp$/.test(value);
  const keys=new Set();
  for(const restaurant of catalog.restaurants) {
    if(!string(restaurant.catalog_key,100)||! /^[a-z0-9-]+$/.test(restaurant.catalog_key)||keys.has(restaurant.catalog_key)||!string(restaurant.name,100)||!string(restaurant.address)||!/^\+380\d{9}$/.test(restaurant.phone)||restaurant.is_active!=null&&typeof restaurant.is_active!=='boolean'||!string(restaurant.cuisine_type,50)||!url(restaurant.website_url)||!url(restaurant.menu_url)||!photo(restaurant.image_url)||!string(restaurant.image_alt)||restaurant.source_checked_at!==catalog.checked_at||!Array.isArray(restaurant.menu)||!restaurant.menu.length)throw new Error('Некоректні джерела закладу');
    keys.add(restaurant.catalog_key);
    if(restaurant.legacy_name!=null&&!string(restaurant.legacy_name,100))throw new Error('Некоректна попередня назва закладу');
    const names=new Set();
    for(const dish of restaurant.menu) {
      if(!string(dish.name,100)||names.has(dish.name)||!string(dish.category,50)||!/^\d{1,8}\.\d{2}$/.test(dish.price)||Number(dish.price)<=0||!url(dish.source_url)||!photo(dish.image_url)||!string(dish.image_alt)||dish.portion!=null&&!string(dish.portion))throw new Error('Некоректні дані страви');
      names.add(dish.name);
    }
  }
}

async function insertRestaurant(db,r) {
  const {rows:[row]}=await db.query('INSERT INTO restaurants(name,address,phone,cuisine_type,image_url,image_alt,website_url,menu_url,source_checked_at,source_note,catalog_key,is_active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id',[r.name,r.address,r.phone,r.cuisine_type,r.image_url,r.image_alt,r.website_url,r.menu_url,r.source_checked_at,r.source_note??null,r.catalog_key,r.is_active??true]);
  for(const d of r.menu)await db.query('INSERT INTO menu_items(restaurant_id,name,description,price,category,image_url,image_alt,source_url,portion) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[row.id,d.name,d.description??null,d.price,d.category,d.image_url,d.image_alt,d.source_url,d.portion??null]);
}

export async function appendCatalog(db,catalog) {
  validateCatalog(catalog);
  await db.query('BEGIN');let added=0;
  try {
    await db.query('SELECT pg_advisory_xact_lock(718202625)');
    for(const r of catalog.restaurants) {
      if((await db.query('SELECT id FROM restaurants WHERE catalog_key=$1',[r.catalog_key])).rowCount)continue;
      const legacy=await db.query('SELECT id FROM restaurants WHERE catalog_key IS NULL AND name=ANY($1::text[]) AND address=$2 FOR UPDATE',[[r.name,...(r.legacy_name?[r.legacy_name]:[])],r.address]);
      if(legacy.rowCount>1)throw new Error('Є кілька однойменних закладів за однією адресою. Записи не змінено.');
      if(legacy.rowCount===1)await db.query('UPDATE restaurants SET catalog_key=$1 WHERE id=$2',[r.catalog_key,legacy.rows[0].id]);
      else if(r.legacy)throw new Error(`Не вдалося однозначно зіставити початковий заклад ${r.name}. Наявні дані збережені. Перевірте його назву й адресу перед розширенням.`);
      else {await insertRestaurant(db,r);added++;}
    }
    await db.query('COMMIT');return added;
  }catch(error){await db.query('ROLLBACK');throw error;}
}

export async function importEmptyCatalog(db,catalog) {
  validateCatalog(catalog);
  await db.query('BEGIN');
  try {
    for(const table of ['restaurants','menu_items','customers','couriers','orders','order_items','reviews','payments']) {
      if((await db.query(`SELECT 1 FROM ${table} LIMIT 1`)).rowCount)throw new Error('Імпорт дозволений лише в порожню нову БД. Дані не очищено.');
    }
    for(const r of catalog.restaurants)await insertRestaurant(db,r);
    await db.query('COMMIT');
  }catch(error){await db.query('ROLLBACK');throw error;}
}

async function backup(config) {
  const native=await import('@embedded-postgres/windows-x64');
  const db=new pg.Client(config);await db.connect();
  let occupied;
  try{occupied=Number((await db.query("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema='public'")).rows[0].n);}finally{await db.end();}
  if(!occupied)return null;
  const candidates=[process.env.DELIVERY_PG_DUMP,path.join(path.dirname(native.pg_ctl),'pg_dump.exe'),path.join(process.env.ProgramFiles??'C:\\Program Files','pgAdmin 4/runtime/pg_dump.exe')].filter(Boolean);
  let executable;
  for(const candidate of candidates){try{await fs.access(candidate);executable=candidate;break;}catch{}}
  if(!executable)throw new Error('Для копії попередньої БД потрібен pg_dump із PostgreSQL або pgAdmin. Вкажіть шлях у DELIVERY_PG_DUMP. Робочі дані не змінено.');
  const folder=path.join(state,'backups');await fs.mkdir(folder,{recursive:true});
  const file=path.join(folder,`${config.database}-${new Date().toISOString().replace(/[:.]/g,'-')}.dump`);
  await new Promise((resolve,reject)=>{
    const child=spawn(executable,['--host',config.host,'--port',String(config.port),'--username',config.user,'--dbname',config.database,'--format=custom','--file',file],{windowsHide:true,stdio:['ignore','ignore','pipe'],env:{...process.env,PGPASSWORD:config.password}});
    let detail='';child.stderr.on('data',chunk=>{detail+=chunk;});
    child.once('error',()=>reject(new Error('Не вдалося створити резервну копію')));
    child.once('exit',code=>code===0?resolve():reject(new Error(`Резервну копію не створено: ${detail.slice(-300)}`)));
  });
  if((await fs.stat(file)).size<100)throw new Error('Резервна копія порожня');
  return path.relative(root,file);
}

export async function catalogDatabase() {
  if(process.env.DELIVERY_DATABASE_URL||process.env.DATABASE_URL)throw new Error('Автоматичний каталог створюється в окремій локальній БД. Приберіть DELIVERY_DATABASE_URL/DATABASE_URL, щоб не змінити зовнішню базу.');
  const runtime=await localDatabase({ignoreSelection:true});
  const admin=new pg.Client(forDatabase(runtime.config,'postgres'));await admin.connect();let failed=true;
  try {
    await admin.query('SELECT pg_advisory_lock(718202624)');
    const raw=await fs.readFile(path.join(root,'data/catalog.json'),'utf8');
    const catalog=JSON.parse(raw);validateCatalog(catalog);
    const locations=await readLocations();
    for(const r of catalog.restaurants)for(const obj of [r,...r.menu])await fs.access(path.join(root,'apps/web/public',obj.image_url));
    const exists=(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[targetName])).rowCount;
    let previous;
    try{previous=JSON.parse(await fs.readFile(selection,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
    if(previous) {
      if(previous.database!==targetName||!exists||previous.catalog_version!==1)throw new Error('Не вдалося підтвердити наявну базу каталогу. Записи не змінено.');
      const config=forDatabase(runtime.config,targetName);await migrate(config);
      const db=new pg.Client(config);await db.connect();
      let added;
      try{added=await appendCatalog(db,catalog);await appendLocations(db,locations);}finally{await db.end();}
      const temp=selection+'.tmp';
      await fs.writeFile(temp,JSON.stringify({...previous,catalog_sha256:createHash('sha256').update(raw).digest('hex'),updated_at:new Date().toISOString()},null,2)+'\n',{mode:0o600});
      await fs.rename(temp,selection);
      if(added)console.log(`Додано закладів: ${added}. Попередні записи та замовлення збережені.`);
      failed=false;return {...runtime,config};
    }
    if(exists)throw new Error('food_delivery_catalog уже існує без запису завершеного імпорту. Наявну БД не очищено.');
    const backupFile=await backup(runtime.config);
    await admin.query(`CREATE DATABASE ${targetName}`);
    const config=forDatabase(runtime.config,targetName);
    const schema=new pg.Client(config);await schema.connect();
    try{await schema.query(await fs.readFile(path.join(root,'db/catalog-schema.sql'),'utf8'));}finally{await schema.end();}
    await migrate(config);
    const fresh=new pg.Client(config);await fresh.connect();
    try{await importEmptyCatalog(fresh,catalog);await appendLocations(fresh,locations);}finally{await fresh.end();}
    const manifest={database:targetName,catalog_version:catalog.version,catalog_sha256:createHash('sha256').update(raw).digest('hex'),created_at:new Date().toISOString(),preserved_database:runtime.config.database,backup:backupFile};
    await fs.writeFile(selection,JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
    console.log(`Реальний каталог: ${targetName}. Попередня БД ${runtime.config.database} збережена; копія: ${backupFile}`);
    failed=false;return {...runtime,config};
  }finally{try{await admin.query('SELECT pg_advisory_unlock(718202624)');}finally{await admin.end();if(failed)runtime.stop();}}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  let database;
  try{database=await catalogDatabase();console.log('Каталог готовий. Повторний запуск не очищає історію.');}
  catch(error){console.error(error instanceof Error?error.message:'Каталог не створено');process.exitCode=1;}
  finally{database?.stop();}
}
