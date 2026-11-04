import assert from 'node:assert/strict';
import {seedAuthDatabase} from '../scripts/auth.mjs';
export async function loginDemo(base,config,{email='admin@demo.test',password='AdminDemo2026!',origin=base}={}) {
  await seedAuthDatabase(config);
  const local=(await fetch(base+'/api/session')).headers.get('set-cookie').split(';')[0];
  const response=await fetch(base+'/api/auth/login',{method:'POST',headers:{cookie:local,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email,password})});
  assert.equal(response.status,200,await response.clone().text());
  return {cookie:local+'; '+response.headers.get('set-cookie').split(';')[0],user:(await response.json()).user};
}
