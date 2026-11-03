import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PGlite} from '@electric-sql/pglite';
import {importEmptyCatalog} from './catalog.mjs';
import {readLocations,appendLocations} from './locations.mjs';
import {applyDemoData} from './demo.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'apps/web/public/demo');
const migrationRoot=path.join(root,'apps/backend/prisma/migrations');
const migrations=(await fs.readdir(migrationRoot,{withFileTypes:true})).filter(row=>row.isDirectory()).map(row=>row.name).sort();
if(migrations.length<4)throw new Error('Missing database migrations');
const schemaFiles=[path.join(root,'db/catalog-schema.sql'),...migrations.slice(4).map(name=>path.join(migrationRoot,name,'migration.sql'))];
const schema=(await Promise.all(schemaFiles.map(file=>fs.readFile(file,'utf8')))).join('\n').replace(/^\s*(?:BEGIN|COMMIT);\s*$/gm,'');
const catalog=JSON.parse(await fs.readFile(path.join(root,'data/catalog.json'),'utf8'));
const demo=JSON.parse(await fs.readFile(path.join(root,'data/demo.json'),'utf8'));
const latest=Math.max(...demo.orders.map(order=>Date.parse(order.date.replace(' ','T')+'Z')));
const shift=Date.now()-2*60*60*1000-latest;
const shifted=value=>new Date(Date.parse(value.replace(' ','T')+'Z')+shift).toISOString().slice(0,19).replace('T',' ');
for(const customer of demo.customers)customer.created_at=shifted(customer.created_at);
for(const order of demo.orders)order.date=shifted(order.date);
demo.version='browser-demo-v1';

const db=await PGlite.create();
const statements=[];
const client={async query(sql,params=[]){
  const result=await db.query(sql,params);
  if(!['BEGIN','COMMIT','ROLLBACK'].includes(sql.trim().replace(/;$/,'').toUpperCase()))statements.push({sql,params});
  return {...result,rowCount:result.rows.length||result.affectedRows||0};
}};
try{
  await db.exec(schema);
  await importEmptyCatalog(client,catalog);
  await appendLocations(client,await readLocations());
  const result=await applyDemoData(client,demo);
  const counts=(await db.query('SELECT (SELECT COUNT(*) FROM restaurants)::integer AS restaurants,(SELECT COUNT(*) FROM menu_items)::integer AS dishes,(SELECT COUNT(*) FROM orders)::integer AS orders')).rows[0];
  if(counts.restaurants!==10||counts.dishes!==318||counts.orders!==30)throw new Error('Unexpected demo catalog counts');
  await fs.mkdir(output,{recursive:true});
  await fs.writeFile(path.join(output,'schema.sql'),schema+'\n');
  await fs.writeFile(path.join(output,'seed.json'),JSON.stringify({schemaVersion:1,createdAt:new Date().toISOString(),statements}));
  console.log(JSON.stringify({browserDemo:counts,statements:statements.length,orders:result.summary.orders}));
}finally{await db.close();}
