import pg from 'pg';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { root } from './database.mjs';
import { runNode,databaseUrl } from './runtime.mjs';
import { schemaSignature } from './schema-signature.mjs';
const folder=path.join(root,'apps/backend/prisma/migrations');
const baselines=['202610010005_base','202610010006_reviews','202610010007_payments','202610010008_integrity'];
export async function migrate(config) {
  const db=new pg.Client(config);await db.connect();
  try {
    await db.query('SELECT pg_advisory_lock(718202602)');
    const managed=(await db.query("SELECT to_regclass('public._prisma_migrations') AS table_name")).rows[0].table_name;
    const occupied=(await db.query("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'")).rows[0].count;
    const names=(await fs.readdir(folder,{withFileTypes:true})).filter(f=>f.isDirectory()).map(f=>f.name).sort();
    const applied=managed?(await db.query('SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations ORDER BY migration_name')).rows:[];
    const finished=applied.filter(m=>m.finished_at&&!m.rolled_back_at);
    const partialBaseline=managed&&Number(occupied)>1&&finished.length<baselines.length&&applied.every(m=>m.finished_at&&!m.rolled_back_at&&baselines.includes(m.migration_name));
    if((!managed&&Number(occupied)>0)||partialBaseline) {
      const expected=JSON.parse(await fs.readFile(path.join(folder,'baseline-schema.json'),'utf8'));
      const actual=await schemaSignature(db);
      if(JSON.stringify(expected)!==JSON.stringify(actual))throw new Error('Схема наявної БД відрізняється від перевіреної версії. Дані не змінено. Перевірте БД перед переходом на Prisma.');
      for(const name of baselines.filter(n=>!finished.some(m=>m.migration_name===n)))await prisma(['migrate','resolve','--applied',name],config);
    }
    if(managed) {
      for(const migration of finished) {
        if(!names.includes(migration.migration_name))throw new Error('У БД є міграція, відсутня в цьому проєкті');
        const sql=await fs.readFile(path.join(folder,migration.migration_name,'migration.sql'));
        if(createHash('sha256').update(sql).digest('hex')!==migration.checksum)throw new Error('Змінено вже застосований файл міграції');
      }
    }
    await prisma(['migrate','deploy'],config);
  } finally {await db.query('SELECT pg_advisory_unlock(718202602)');await db.end();}
}
export const connectionString=databaseUrl;
export function prisma(args,config) {
  return runNode(path.join(root,'node_modules/prisma/build/index.js'),args,{cwd:path.join(root,'apps/backend'),env:{...process.env,DATABASE_URL:connectionString(config)}});
}
