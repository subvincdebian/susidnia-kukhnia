import { createApplication } from './application.js';
const connectionString=process.env.DATABASE_URL??process.env.DELIVERY_DATABASE_URL;
if(!connectionString)throw new Error('Запускайте сайт командою npm start з кореня susidnia-kukhnia');
const port=Number(process.env.PORT??3000);
const app=await createApplication({connectionString,devOrigin:process.env.DELIVERY_DEV==='1'?'http://127.0.0.1:5173':undefined});
await app.listen(port,'127.0.0.1');
console.log(`Сусідня кухня: http://127.0.0.1:${port}`);
app.enableShutdownHooks();
