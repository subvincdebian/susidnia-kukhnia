import { Prisma } from '../generated/prisma/client.js';
import pg from 'pg';
const parseLocalTimestamp=pg.types.getTypeParser(1114,'text');
export function serialize(value: unknown): unknown {
  if(value instanceof Prisma.Decimal)return value.toFixed(2);
  if(typeof value==='bigint')return String(value);
  if(value instanceof Date)return parseLocalTimestamp(value.toISOString().slice(0,-1).replace('T',' ')).toISOString();
  if(Array.isArray(value))return value.map(serialize);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,serialize(item)]));
  return value;
}
