import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { HttpError } from './validation.js';
function records(value: unknown,depth=0): Record<string,unknown>[] {
  if(!value||typeof value!=='object'||depth>5)return [];
  const current=Object.fromEntries(Object.entries(value));
  return [current,...['meta','cause','driverAdapterError'].flatMap(key=>records(current[key],depth+1))];
}
export function publicError(error: unknown): HttpError {
  if(error instanceof HttpError)return error;
  const parts=records(error),code=parts.flatMap(p=>[p.code,p.originalCode,p.sqlState]).find(v=>typeof v==='string'&&/^(23505|23503|23514|P0002|40001|40P01)$/.test(v));
  const prismaCode=parts.find(p=>typeof p.code==='string'&&/^P\d{4}$/.test(p.code))?.code;
  if(code==='23505'||prismaCode==='P2002')return new HttpError(409,'Такий запис уже існує. Перевірте унікальні поля');
  if(code==='23503'||prismaCode==='P2003')return new HttpError(409,"Пов'язаний запис відсутній або використовується");
  if(code==='23514'||prismaCode==='P2004')return new HttpError(409,'Дані порушують правила цієї операції. Перевірте статус і значення полів');
  if(code==='P0002'||prismaCode==='P2025')return new HttpError(404,'Запис не знайдено');
  if(code==='40001'||code==='40P01'||prismaCode==='P2034')return new HttpError(409,'Дані змінилися одночасно. Оновіть сторінку та повторіть дію');
  if(error instanceof URIError)return new HttpError(400,'Некоректна адреса запиту');
  const fastifyCode=parts.find(p=>typeof p.code==='string'&&p.code.startsWith('FST_'))?.code;
  if(fastifyCode==='FST_ERR_CTP_BODY_TOO_LARGE')return new HttpError(413,'Забагато даних');
  if(fastifyCode==='FST_ERR_CTP_INVALID_MEDIA_TYPE')return new HttpError(415,'Потрібен формат JSON');
  if(error instanceof HttpException)return new HttpError(error.getStatus(),error.getStatus()===404?'Сторінку не знайдено':error.message);
  return new HttpError(500,'Не вдалося виконати операцію. Повторіть спробу');
}
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  catch(exception: unknown,host: ArgumentsHost) {
    const error=publicError(exception);
    if(error.status===500)console.error('Request failed',{kind:exception instanceof Error?exception.name:'unknown'});
    host.switchToHttp().getResponse<FastifyReply>().status(error.status).send({message:error.message,fields:error.fields});
  }
}
