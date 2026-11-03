import fs from 'node:fs/promises';
import path from 'node:path';
import { root } from './database.mjs';

export function validateLocations(data) {
  if(!data||data.version!==1||!/^\d{4}-\d{2}-\d{2}$/.test(data.checked_at)||!Array.isArray(data.restaurants)||data.restaurants.length>500)throw new Error('Некоректний набір координат');
  const keys=new Set();
  for(const row of data.restaurants) {
    let source;
    try{source=new URL(row.coordinate_source);}catch{throw new Error('Немає джерела координат');}
    if(typeof row.catalog_key!=='string'||! /^[a-z0-9-]{1,100}$/.test(row.catalog_key)||keys.has(row.catalog_key)||typeof row.address!=='string'||!row.address.trim()||row.address.length>200||typeof row.latitude!=='number'||!Number.isFinite(row.latitude)||row.latitude< -90||row.latitude>90||typeof row.longitude!=='number'||!Number.isFinite(row.longitude)||row.longitude< -180||row.longitude>180||source.protocol!=='https:'||source.username||source.password)throw new Error('Некоректні координати закладу');
    keys.add(row.catalog_key);
  }
}
export async function readLocations() {
  const data=JSON.parse(await fs.readFile(path.join(root,'data/restaurant-locations.json'),'utf8'));
  validateLocations(data);
  return data;
}
export async function appendLocations(db,data) {
  validateLocations(data);
  await db.query('BEGIN');
  let added=0;
  try {
    await db.query('SELECT pg_advisory_xact_lock(718202614)');
    for(const row of data.restaurants) {
      const result=await db.query('UPDATE restaurants SET latitude=$1,longitude=$2,coordinate_source=$3 WHERE catalog_key=$4 AND address=$5 AND latitude IS NULL AND longitude IS NULL AND coordinate_source IS NULL',[row.latitude,row.longitude,row.coordinate_source,row.catalog_key,row.address]);
      added+=result.rowCount;
    }
    await db.query('COMMIT');
    return added;
  }catch(error){await db.query('ROLLBACK');throw error;}
}
