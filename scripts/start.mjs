import { catalogDatabase } from './catalog.mjs';
import { connectionString } from './migrations.mjs';
import { build } from './runtime.mjs';
import { seedDemoDatabase } from './demo.mjs';
import { seedAuthDatabase } from './auth.mjs';
let database,app,closing=false;
async function stop() {
  if(closing)return;closing=true;
  try {if(app)await app.close();} finally {database?.stop();}
}
process.once('SIGINT',()=>stop().then(()=>process.exit(0)));
process.once('SIGTERM',()=>stop().then(()=>process.exit(0)));
try {
  await build();database=await catalogDatabase();
  await seedDemoDatabase(database.config);
  await seedAuthDatabase(database.config);
  const {createApplication}=await import('../apps/backend/dist/application.js');
  app=await createApplication({connectionString:connectionString(database.config),devOrigin:process.env.DELIVERY_DEV==='1'?'http://127.0.0.1:5173':undefined});
  await app.listen(Number(process.env.PORT??3000),'127.0.0.1');
  console.log(`Сусідня кухня: ${await app.getUrl()}`);
  console.log('Дані зберігаються між запусками. Для зупинки натисніть Ctrl+C.');
} catch(error) {
  console.error('Запуск не виконано:',error instanceof Error?error.message:'невідома помилка');
  await stop();process.exitCode=1;
}
