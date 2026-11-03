export interface GeoPoint {
  latitude: number;
  longitude: number;
}
export interface GeoPlace extends GeoPoint {
  id: string;
  label: string;
  source_url: string;
}
export interface GeoRoute {
  coordinates: [number, number][];
  distance_meters: number;
  duration_seconds: number;
  source: string;
}
export function geoPoint(
  latitude: unknown,
  longitude: unknown,
): GeoPoint | null {
  return typeof latitude === "number" &&
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    typeof longitude === "number" &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180
    ? { latitude, longitude }
    : null;
}
export const samePoint = (a: GeoPoint | null, b: GeoPoint | null) =>
  a?.latitude === b?.latitude && a?.longitude === b?.longitude;
export function mapPointUrl(point: GeoPoint) {
  return `https://www.openstreetmap.org/?mlat=${point.latitude}&mlon=${point.longitude}#map=18/${point.latitude}/${point.longitude}`;
}
export function navigationUrl(destination: GeoPoint, origin?: GeoPoint | null) {
  const params = new URLSearchParams({
    api: "1",
    destination: `${destination.latitude},${destination.longitude}`,
    travelmode: "driving",
  });
  if (origin) params.set("origin", `${origin.latitude},${origin.longitude}`);
  return `https://www.google.com/maps/dir/?${params}`;
}
export function routeDistance(metres: number) {
  return metres < 1000
    ? `${Math.round(metres / 10) * 10} м`
    : `${(metres / 1000).toLocaleString("uk-UA", { maximumFractionDigits: 1 })} км`;
}
