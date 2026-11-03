import type { GeoPoint } from "../../shared/lib";

export const addressUpdate = (
  address: string,
  version: number,
  point: GeoPoint | null,
) => ({
  delivery_address: address,
  expected_version: version,
  ...(point
    ? { delivery_latitude: point.latitude, delivery_longitude: point.longitude }
    : {}),
});

export const canChangeDeliveryAddress = (
  status: string,
  courierId: number | null,
) => (status === "створено" || status === "готується") && courierId === null;
export function locationFreshness(stamp: string | null, now = Date.now()) {
  if (!stamp) return "missing";
  const time = Date.parse(stamp);
  if (!Number.isFinite(time) || time > now + 60000) return "missing";
  return now - time <= 120000 ? "fresh" : "stale";
}
export const canPublishLocation = (lastSent: number, now: number) =>
  now - lastSent >= 15000;
export interface MessageAttempt {
  sender: "customer" | "courier";
  body: string;
  request_key: string;
  courier_id?: number;
}
export function decodeMessageAttempt(
  raw: string | null,
): MessageAttempt | null {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (
      !value ||
      typeof value !== "object" ||
      !("sender" in value) ||
      !("body" in value) ||
      !("request_key" in value)
    )
      return null;
    if (
      (value.sender !== "customer" && value.sender !== "courier") ||
      typeof value.body !== "string" ||
      !value.body.trim() ||
      value.body.length > 1000 ||
      typeof value.request_key !== "string" ||
      !/^[A-Za-z0-9_-]{8,64}$/.test(value.request_key)
    )
      return null;
    if (value.sender === "courier") {
      if (
        !("courier_id" in value) ||
        typeof value.courier_id !== "number" ||
        !Number.isSafeInteger(value.courier_id) ||
        value.courier_id < 1
      )
        return null;
      return {
        sender: value.sender,
        body: value.body,
        request_key: value.request_key,
        courier_id: value.courier_id,
      };
    }
    return {
      sender: value.sender,
      body: value.body,
      request_key: value.request_key,
    };
  } catch {
    return null;
  }
}
