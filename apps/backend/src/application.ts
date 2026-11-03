import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { map } from 'rxjs';
import { AppModule } from './app.module.js';
import { ApiErrorFilter } from './common/api-error.filter.js';
import { HttpError } from './common/validation.js';
import { serialize } from './common/serialization.js';
import { PrismaService } from './prisma/prisma.service.js';
import { mapTileConfiguration } from './geo/map-tiles.js';
export interface ApplicationOptions { connectionString:string; webRoot?:string; devOrigin?:string; }
export async function createApplication(options: ApplicationOptions) {
  process.env.TZ='Europe/Kyiv';
  const mapTiles=mapTileConfiguration();
  const session=randomBytes(32).toString('hex');
  const adapter=new FastifyAdapter({bodyLimit:40000,logger:false});
  const app=await NestFactory.create<NestFastifyApplication>(AppModule.register(options.connectionString),adapter,{logger:false,bodyParser:false,abortOnError:false});
  const fastify=adapter.getInstance();
  fastify.removeContentTypeParser('application/json');
  fastify.addContentTypeParser('application/json',{parseAs:'buffer',bodyLimit:40000},(_request,body,done)=>{
    try { const value: unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(typeof body==='string'?Buffer.from(body):body));done(null,value); }
    catch { done(new HttpError(400,'Некоректний формат запиту')); }
  });
  fastify.addHook('onRequest',async(request: FastifyRequest,reply: FastifyReply)=>{
    reply.header('X-Content-Type-Options','nosniff').header('Referrer-Policy','strict-origin-when-cross-origin').header('Cache-Control','no-store');
    reply.header('Content-Security-Policy',`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: ${mapTiles.tile_origin}; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`);
    const port=fastify.server.address();
    const actualPort=typeof port==='object'&&port?port.port:3000;
    const host=request.headers.host;
    if(![`127.0.0.1:${actualPort}`,`localhost:${actualPort}`].includes(host??''))throw new HttpError(403,'Доступ дозволено лише через локальну адресу');
    if(!request.url.startsWith('/')||request.url.startsWith('//'))throw new HttpError(400,'Некоректна адреса запиту');
    let pathname: string;
    try { pathname=decodeURIComponent(new URL(request.url,`http://${host}`).pathname); }
    catch { throw new HttpError(400,'Некоректна адреса запиту'); }
    const route=request.routeOptions.url;
    const isSession=route==='/api/session'&&request.method==='GET';
    if(isSession||pathname==='/'||pathname==='/index.html')reply.header('Set-Cookie',`delivery_session=${session}; HttpOnly; SameSite=Strict; Path=/`);
    if((route?.startsWith('/api/')||pathname.startsWith('/api/'))&&!isSession) {
      if(!request.headers.cookie?.split(';').some(c=>c.trim()===`delivery_session=${session}`))throw new HttpError(401,'Оновіть сторінку, щоб почати локальний сеанс');
      if(request.method!=='GET') {
        if(request.headers.origin!==`http://${host}`&&(!options.devOrigin||request.headers.origin!==options.devOrigin))throw new HttpError(403,'Запит має надійти зі сторінки застосунку');
        if(!request.headers['content-type']?.startsWith('application/json'))throw new HttpError(415,'Потрібен формат JSON');
      }
    }
  });
  app.useGlobalFilters(new ApiErrorFilter());
  app.useGlobalInterceptors({intercept:(_context,next)=>next.handle().pipe(map(serialize))});
  app.useStaticAssets({root:options.webRoot??path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../web/dist'),wildcard:false});
  try {
    await app.init();
    await app.get(PrismaService).$connect();
    return app;
  } catch(error) {await app.close();throw error;}
}
