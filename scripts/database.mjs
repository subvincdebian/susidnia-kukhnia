import fs from 'node:fs/promises';
import {openSync,closeSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import pg from 'pg';

export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const state=path.join(root,'.local');
function command(exe,args){
  // Файлові дескриптори не утримують pipe відкритим у дочірнього postgres.exe.
  const log=path.join(state,'setup.log'),fd=openSync(log,'a');let result;
  try{result=spawnSync(exe,args,{windowsHide:true,encoding:'utf8',cwd:path.dirname(exe),stdio:['ignore',fd,fd],timeout:60000});}finally{closeSync(fd);}
  if(result.status!==0)throw new Error(`Не вдалося запустити PostgreSQL: ${result.error?.message||readFileSync(log,'utf8').slice(-1800)}`);
}
function windowsShortPath(folder){
  // initdb передає шлях у bootstrap SQL; у Windows потрібен шлях без ACP-символів.
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','$fso = New-Object -ComObject Scripting.FileSystemObject; $fso.GetFolder($env:DELIVERY_SHORT_PATH).ShortPath'],{windowsHide:true,encoding:'utf8',env:{...process.env,DELIVERY_SHORT_PATH:folder}});
  const value=result.stdout?.trim();if(result.status!==0||!value||/[^\x00-\x7f]/.test(value))throw new Error('Для PostgreSQL потрібен короткий шлях Windows. Розпакуйте susidnia-kukhnia у папку з латинською назвою.');return value;
}
export async function localDatabase({test=false,ignoreSelection=false}={}){
  const external=process.env.DELIVERY_DATABASE_URL??process.env.DATABASE_URL;
  if(external)return {config:{connectionString:external},stop:()=>{}};
  if(process.platform!=='win32'||process.arch!=='x64')throw new Error('Для вбудованого PostgreSQL потрібна Windows x64. На іншій ОС задайте DELIVERY_DATABASE_URL до окремої порожньої демонстраційної БД.');
  const state=path.join(root,'.local',test?'tests':'');
  const binaries=await import('@embedded-postgres/windows-x64');
  await fs.mkdir(state,{recursive:true});
  const nativeFolder=windowsShortPath(path.dirname(binaries.pg_ctl)),shortState=windowsShortPath(state);
  const native={initdb:path.join(nativeFolder,'initdb.exe'),pg_ctl:path.join(nativeFolder,'pg_ctl.exe')};
  const configPath=path.join(state,'database.json');let config;
  try{config=JSON.parse(await fs.readFile(configPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;config={host:'127.0.0.1',port:test?56434:56433,user:'postgres',password:randomBytes(24).toString('hex'),database:test?'postgres':'food_delivery'};await fs.writeFile(configPath,JSON.stringify(config),{mode:0o600});}
  if(!test&&!ignoreSelection){
    try{
      const selected=JSON.parse(await fs.readFile(path.join(state,'active-database.json'),'utf8'));
      if(!/^food_delivery_catalog(?:_[a-z0-9]+)?$/.test(selected.database))throw new Error('Некоректна назва каталогу');
      config={...config,database:selected.database};
    }catch(e){if(e.code!=='ENOENT')throw e;}
  }
  const data=path.join(shortState,'pgdata');
  try{await fs.access(path.join(data,'PG_VERSION'));}catch{
    const pw=path.join(shortState,'init-password');await fs.writeFile(pw,config.password,{mode:0o600});
    try{command(native.initdb,['-D',data,'-U',config.user,'--auth=scram-sha-256','--encoding=UTF8','--locale=C',`--pwfile=${pw}`]);}finally{await fs.unlink(pw);}
  }
  const status=spawnSync(native.pg_ctl,['-D',data,'status'],{windowsHide:true,encoding:'utf8'});let started=false;
  if(status.status!==0){command(native.pg_ctl,['-D',data,'-l',path.join(shortState,'postgres.log'),'-o',`-h 127.0.0.1 -p ${config.port}`,'-w','start']);started=true;}
  const admin=new pg.Client({...config,database:'postgres'});await admin.connect();
  try{const r=await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[config.database]);if(!r.rowCount){if(config.database!=='food_delivery'&&config.database!=='postgres')throw new Error('Базу каталогу не знайдено. Виконайте npm run db:catalog.');await admin.query('CREATE DATABASE food_delivery');}}finally{await admin.end();}
  return {config,stop:()=>{if(started)spawnSync(native.pg_ctl,['-D',data,'-m','fast','-w','stop'],{windowsHide:true,encoding:'utf8'});}};
}
