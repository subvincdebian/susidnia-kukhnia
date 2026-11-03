import { Injectable } from "@nestjs/common";
import { HttpError, text } from "../common/validation.js";
import { coordinate, type Coordinates } from "../common/coordinates.js";
import { mapTileConfiguration } from "./map-tiles.js";

export interface GeoPlace extends Coordinates {
  id: string;
  label: string;
  source_url: string;
}
export interface DrivingRoute {
  coordinates: [number, number][];
  distance_meters: number;
  duration_seconds: number;
  source: "OSRM";
}

const unavailable = () => new HttpError(503, "Сервіс карти тимчасово недоступний. Повторіть спробу або вкажіть адресу вручну");
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const CACHE_LIMIT = 100;
const INFLIGHT_LIMIT = 8;

// One queue per provider for this process, including separate app instances.
// Requests start at most once a second; queued work and in-memory caches are bounded.
function providerQueue() {
  let tail = Promise.resolve();
  let waiting = 0;
  let nextAt = 0;
  return function schedule<T>(operation: () => Promise<T>): Promise<T> {
    if (waiting >= INFLIGHT_LIMIT) return Promise.reject(unavailable());
    waiting++;
    const task = tail.then(async () => {
      const delay = Math.max(0, nextAt - Date.now());
      if (delay) await new Promise<void>((resolve) => setTimeout(resolve, delay));
      nextAt = Date.now() + 1000;
      return operation();
    });
    tail = task.then(() => undefined, () => undefined);
    return task.finally(() => { waiting--; });
  };
}
const geocodeRequest = providerQueue();
const routeRequest = providerQueue();

class ProviderCache<T> {
  private readonly values = new Map<string,{expires:number,value:T}>();
  private readonly inflight = new Map<string,Promise<T>>();
  get(key: string,ttl: number,operation: () => Promise<T>): Promise<T> {
    const cached = this.values.get(key);
    if (cached && cached.expires > Date.now()) return Promise.resolve(cached.value);
    const running = this.inflight.get(key);
    if (running) return running;
    if (this.inflight.size >= INFLIGHT_LIMIT) return Promise.reject(unavailable());
    const task = operation().then((value) => {
      if (this.values.size >= CACHE_LIMIT) {
        const oldest = this.values.keys().next().value;
        if (oldest !== undefined) this.values.delete(oldest);
      }
      this.values.set(key,{expires:Date.now()+ttl,value});
      return value;
    }).finally(() => { this.inflight.delete(key); });
    this.inflight.set(key,task);
    return task;
  }
}

function configuredBase(name: string, fallback: string) {
  try {
    const url = new URL(process.env[name] ?? fallback);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
      throw new Error('invalid provider configuration');
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    return url;
  } catch {
    // Do not expose deployment configuration or credentials in a public error.
    throw new Error(`Некоректне налаштування ${name}: потрібна базова HTTPS-адреса без облікових даних`);
  }
}
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value)) : null;
}
function labelPart(value: unknown) {
  return typeof value === 'string' ? value.trim().slice(0,160) : '';
}
function point(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const [longitude, latitude] = value;
  if (typeof latitude !== 'number' || typeof longitude !== 'number'
      || !Number.isFinite(latitude) || !Number.isFinite(longitude)
      || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return [longitude, latitude];
}
function place(value: unknown): GeoPlace | null {
  const feature = record(value), geometry = record(feature?.geometry), properties = record(feature?.properties);
  const position = point(geometry?.coordinates);
  if (geometry?.type !== 'Point' || !position || !properties) return null;
  const kind = properties.osm_type;
  const osmType = kind === 'N' ? 'node' : kind === 'W' ? 'way' : kind === 'R' ? 'relation' : null;
  const osmId = typeof properties.osm_id === 'number' && Number.isSafeInteger(properties.osm_id)
    ? String(properties.osm_id) : labelPart(properties.osm_id);
  if (!osmType || !/^[1-9]\d*$/.test(osmId)) return null;
  const street = [labelPart(properties.street), labelPart(properties.housenumber)].filter(Boolean).join(', ');
  const parts = [
    labelPart(properties.name), street,
    labelPart(properties.city) || labelPart(properties.district),
    labelPart(properties.state), labelPart(properties.country),
  ].filter(Boolean);
  return {
    id: `${osmType}/${osmId}`,
    label: [...new Set(parts)].join(', ') || 'Позначене місце',
    latitude: position[1], longitude: position[0],
    source_url: `https://www.openstreetmap.org/${osmType}/${osmId}`,
  };
}
function numberQuery(value: unknown, name: string, maximum: number) {
  if (typeof value !== 'string' || !value.trim())
    return coordinate(undefined,name,maximum);
  return coordinate(Number(value),name,maximum);
}
export function queryCoordinates(input: Record<string, unknown>, prefix = ''): Coordinates {
  return {
    latitude: numberQuery(input[prefix+'latitude'],prefix+'latitude',90),
    longitude: numberQuery(input[prefix+'longitude'],prefix+'longitude',180),
  };
}
const positionKey = (position: Coordinates) => `${position.latitude.toFixed(5)},${position.longitude.toFixed(5)}`;

@Injectable()
export class GeoService {
  private readonly photon = configuredBase('DELIVERY_PHOTON_URL','https://photon.komoot.io/');
  private readonly osrm = configuredBase('DELIVERY_OSRM_URL','https://router.project-osrm.org/');
  private readonly tiles = mapTileConfiguration();
  private readonly searchCache = new ProviderCache<{items:GeoPlace[]}>();
  private readonly reverseCache = new ProviderCache<{place:GeoPlace|null}>();
  private readonly routeCache = new ProviderCache<DrivingRoute>();

  configuration() { return {tile_url:this.tiles.tile_url}; }

  search(query: unknown) {
    const q = text(query,'q',160,3).replace(/\s+/g,' ');
    return this.searchCache.get(q.toLocaleLowerCase('uk'),3600000,async () => {
      const url = new URL('api',this.photon);
      url.search = new URLSearchParams({q,limit:'5',lat:'50.4501',lon:'30.5234',countrycode:'UA'}).toString();
      const data = record(await geocodeRequest(() => this.request(url)));
      if (!Array.isArray(data?.features)) throw unavailable();
      return {items:data.features.slice(0,5).map(place).filter((item) => item !== null)};
    });
  }
  reverse(position: Coordinates) {
    return this.reverseCache.get(positionKey(position),3600000,async () => {
      const url = new URL('reverse',this.photon);
      url.search = new URLSearchParams({lat:String(position.latitude),lon:String(position.longitude),limit:'1',radius:'0.2'}).toString();
      const data = record(await geocodeRequest(() => this.request(url)));
      if (!Array.isArray(data?.features)) throw unavailable();
      return {place:place(data.features[0])};
    });
  }
  route(from: Coordinates, to: Coordinates) {
    return this.routeCache.get(`${positionKey(from)}:${positionKey(to)}`,60000,async () => {
      const path = `route/v1/driving/${from.longitude},${from.latitude};${to.longitude},${to.latitude}`;
      const url = new URL(path,this.osrm);
      url.search = new URLSearchParams({overview:'full',geometries:'geojson',steps:'false'}).toString();
      const data = record(await routeRequest(() => this.request(url)));
      if (data?.code === 'NoRoute')
        throw new HttpError(404,"Не вдалося знайти автомобільний маршрут між цими точками");
      const first = Array.isArray(data?.routes) ? record(data.routes[0]) : null;
      const geometry = record(first?.geometry);
      if (data?.code !== 'Ok' || geometry?.type !== 'LineString' || !Array.isArray(geometry.coordinates)
          || geometry.coordinates.length < 2 || geometry.coordinates.length > 20000
          || typeof first?.distance !== 'number' || !Number.isFinite(first.distance) || first.distance < 0
          || typeof first.duration !== 'number' || !Number.isFinite(first.duration) || first.duration < 0)
        throw unavailable();
      const coordinates: [number,number][] = [];
      for (const value of geometry.coordinates) {
        const pair = point(value);
        if (!pair) throw unavailable();
        coordinates.push(pair);
      }
      const result: DrivingRoute = {
        coordinates,distance_meters:first.distance,duration_seconds:first.duration,source:'OSRM',
      };
      return result;
    });
  }
  private async request(url: URL): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(),8000);
    try {
      const response = await fetch(url,{
        signal:controller.signal,redirect:'error',
        headers:{Accept:'application/json','Accept-Language':'uk'},
      });
      if (!response.ok || !response.body) throw unavailable();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let size = 0, body = '';
      try {
        while (true) {
          const {done,value} = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_RESPONSE_BYTES) {
            await reader.cancel();
            throw unavailable();
          }
          body += decoder.decode(value,{stream:true});
        }
      } finally { reader.releaseLock(); }
      body += decoder.decode();
      const data: unknown = JSON.parse(body);
      return data;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw unavailable();
    } finally { clearTimeout(timer); }
  }
}
