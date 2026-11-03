import { BrowserApiError, coordinate, fail, text } from "./validation.ts";

interface Coordinates { latitude: number; longitude: number }
interface GeoPlace extends Coordinates { id: string; label: string; source_url: string }
interface DrivingRoute { coordinates: [number, number][]; distance_meters: number; duration_seconds: number; source: "OSRM" }
const unavailable = () => new BrowserApiError("Сервіс карти тимчасово недоступний. Повторіть спробу або вкажіть адресу вручну", {}, 503);
const cacheLimit = 100, inflightLimit = 8, responseLimit = 2 * 1024 * 1024;

function providerQueue() {
  let tail = Promise.resolve(), waiting = 0, nextAt = 0;
  return function schedule<T>(operation: () => Promise<T>): Promise<T> {
    if (waiting >= inflightLimit) return Promise.reject(unavailable());
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
const geocodeRequest = providerQueue(), routeRequest = providerQueue();
class ProviderCache<T> {
  private readonly values = new Map<string, { expires: number; value: T }>();
  private readonly inflight = new Map<string, Promise<T>>();
  get(key: string, ttl: number, operation: () => Promise<T>): Promise<T> {
    const cached = this.values.get(key);
    if (cached && cached.expires > Date.now()) return Promise.resolve(cached.value);
    const running = this.inflight.get(key);
    if (running) return running;
    if (this.inflight.size >= inflightLimit) return Promise.reject(unavailable());
    const task = operation().then((value) => {
      if (this.values.size >= cacheLimit) {
        const oldest = this.values.keys().next().value;
        if (oldest !== undefined) this.values.delete(oldest);
      }
      this.values.set(key, { expires: Date.now() + ttl, value });
      return value;
    }).finally(() => { this.inflight.delete(key); });
    this.inflight.set(key, task);
    return task;
  }
}
const searchCache = new ProviderCache<{ items: GeoPlace[] }>();
const reverseCache = new ProviderCache<{ place: GeoPlace | null }>();
const routeCache = new ProviderCache<DrivingRoute>();
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : null;
}
const labelPart = (value: unknown) => typeof value === "string" ? value.trim().slice(0, 160) : "";
function point(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const [longitude, latitude] = value;
  if (typeof latitude !== "number" || typeof longitude !== "number" || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return [longitude, latitude];
}
function place(value: unknown): GeoPlace | null {
  const feature = record(value), geometry = record(feature?.geometry), properties = record(feature?.properties), position = point(geometry?.coordinates);
  if (geometry?.type !== "Point" || !position || !properties) return null;
  const kind = properties.osm_type, osmType = kind === "N" ? "node" : kind === "W" ? "way" : kind === "R" ? "relation" : null;
  const osmId = typeof properties.osm_id === "number" && Number.isSafeInteger(properties.osm_id) ? String(properties.osm_id) : labelPart(properties.osm_id);
  if (!osmType || !/^[1-9]\d*$/.test(osmId)) return null;
  const street = [labelPart(properties.street), labelPart(properties.housenumber)].filter(Boolean).join(", ");
  const parts = [labelPart(properties.name), street, labelPart(properties.city) || labelPart(properties.district), labelPart(properties.state), labelPart(properties.country)].filter(Boolean);
  return {
    id: `${osmType}/${osmId}`, label: [...new Set(parts)].join(", ") || "Позначене місце",
    latitude: position[1], longitude: position[0], source_url: `https://www.openstreetmap.org/${osmType}/${osmId}`,
  };
}
function queryCoordinates(query: URLSearchParams, prefix = ""): Coordinates {
  function value(name: string, maximum: number) {
    const raw = query.get(name);
    return coordinate(raw === null || !raw.trim() ? undefined : Number(raw), name, maximum);
  }
  return { latitude: value(prefix + "latitude", 90), longitude: value(prefix + "longitude", 180) };
}
const positionKey = (position: Coordinates) => `${position.latitude.toFixed(5)},${position.longitude.toFixed(5)}`;

async function request(url: URL): Promise<unknown> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(8000), redirect: "error", credentials: "omit", referrerPolicy: "no-referrer",
      headers: { Accept: "application/json", "Accept-Language": "uk" },
    });
    if (!response.ok || !response.body) throw unavailable();
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let size = 0, body = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > responseLimit) { await reader.cancel(); throw unavailable(); }
        body += decoder.decode(value, { stream: true });
      }
    } finally { reader.releaseLock(); }
    body += decoder.decode();
    const data: unknown = JSON.parse(body);
    return data;
  } catch (error) {
    if (error instanceof BrowserApiError) throw error;
    throw unavailable();
  }
}
function search(value: unknown) {
  const q = text(value, "q", 160, 3).replace(/\s+/g, " ");
  return searchCache.get(q.toLocaleLowerCase("uk"), 3600000, async () => {
    const url = new URL("https://photon.komoot.io/api");
    url.search = new URLSearchParams({ q, limit: "5", lat: "50.4501", lon: "30.5234", countrycode: "UA" }).toString();
    const data = record(await geocodeRequest(() => request(url)));
    if (!Array.isArray(data?.features)) throw unavailable();
    return { items: data.features.slice(0, 5).map(place).filter((item) => item !== null) };
  });
}
function reverse(position: Coordinates) {
  return reverseCache.get(positionKey(position), 3600000, async () => {
    const url = new URL("https://photon.komoot.io/reverse");
    url.search = new URLSearchParams({ lat: String(position.latitude), lon: String(position.longitude), limit: "1", radius: "0.2" }).toString();
    const data = record(await geocodeRequest(() => request(url)));
    if (!Array.isArray(data?.features)) throw unavailable();
    return { place: place(data.features[0]) };
  });
}
function route(from: Coordinates, to: Coordinates) {
  return routeCache.get(`${positionKey(from)}:${positionKey(to)}`, 60000, async () => {
    const url = new URL(`https://router.project-osrm.org/route/v1/driving/${from.longitude},${from.latitude};${to.longitude},${to.latitude}`);
    url.search = new URLSearchParams({ overview: "full", geometries: "geojson", steps: "false" }).toString();
    const data = record(await routeRequest(() => request(url)));
    if (data?.code === "NoRoute") fail(404, "Не вдалося знайти автомобільний маршрут між цими точками");
    const first = Array.isArray(data?.routes) ? record(data.routes[0]) : null, geometry = record(first?.geometry);
    if (data?.code !== "Ok" || geometry?.type !== "LineString" || !Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2 || geometry.coordinates.length > 20000
      || typeof first?.distance !== "number" || !Number.isFinite(first.distance) || first.distance < 0 || typeof first.duration !== "number" || !Number.isFinite(first.duration) || first.duration < 0)
      throw unavailable();
    const coordinates: [number, number][] = [];
    for (const value of geometry.coordinates) {
      const pair = point(value);
      if (!pair) throw unavailable();
      coordinates.push(pair);
    }
    return { coordinates, distance_meters: first.distance, duration_seconds: first.duration, source: "OSRM" };
  });
}

export async function geoRequest(path: string, signal?: AbortSignal): Promise<unknown> {
  signal?.throwIfAborted();
  const url = new URL(path, "https://browser.invalid");
  switch (url.pathname) {
    case "/geo/config": return { tile_url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png" };
    case "/geo/search": return search(url.searchParams.get("q"));
    case "/geo/reverse": return reverse(queryCoordinates(url.searchParams));
    case "/geo/route": return route(queryCoordinates(url.searchParams, "from_"), queryCoordinates(url.searchParams, "to_"));
    default: fail(404, "Сторінку не знайдено");
  }
}
