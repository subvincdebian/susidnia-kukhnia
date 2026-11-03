import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
for(const directory of ['scripts','tests']) {
  for(const name of await fs.readdir(directory)) {
    if(!name.endsWith('.mjs'))continue;
    const result=spawnSync(process.execPath,['--check',path.join(directory,name)],{stdio:'inherit',windowsHide:true});
    if(result.status!==0)process.exit(result.status??1);
  }
}
console.log('Скрипти запуску й тестів перевірено.');
