import { spawn } from 'node:child_process';
import path from 'node:path';
import { root } from './database.mjs';
export function databaseUrl(config) {
  if(config.connectionString)return config.connectionString;
  const url=new URL(`postgresql://${encodeURIComponent(config.user)}:${encodeURIComponent(config.password)}@${config.host}:${config.port}/${encodeURIComponent(config.database)}`);
  if(['127.0.0.1','localhost','::1'].includes(config.host))url.searchParams.set('sslmode','disable');
  url.searchParams.set('connect_timeout','5');
  return url.toString();
}
export function forDatabase(config,name) {
  if(!/^[a-z][a-z0-9_]*$/.test(name))throw new Error('Некоректна назва бази даних');
  const url=new URL(databaseUrl(config));
  if(!['postgres:','postgresql:'].includes(url.protocol))throw new Error('Потрібен PostgreSQL URL');
  url.pathname='/'+name;
  return {connectionString:url.toString()};
}
export function runNode(file,args=[],options={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--use-system-ca',file,...args],{cwd:root,windowsHide:true,stdio:'inherit',...options});
    child.once('error',()=>reject(new Error('Не вдалося запустити інструмент проєкту')));
    child.once('exit',code=>code===0?resolve():reject(new Error(`Команда завершилася з кодом ${code}`)));
  });
}
export async function build() {
  await runNode(path.join(root,'node_modules/prisma/build/index.js'),['generate'],{cwd:path.join(root,'apps/backend')});
  await runNode(path.join(root,'node_modules/typescript/bin/tsc'),['-p','apps/backend/tsconfig.json']);
  await runNode(path.join(root,'node_modules/typescript/bin/tsc'),['--noEmit','-p','apps/web/tsconfig.json']);
  await runNode(path.join(root,'node_modules/vite/bin/vite.js'),['build'],{cwd:path.join(root,'apps/web')});
}
