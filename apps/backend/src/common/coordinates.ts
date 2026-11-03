import { HttpError } from "./validation.js";

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export function coordinate(value: unknown, name: string, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > maximum)
    throw new HttpError(400, "Перевірте координати", {
      [name]: `Число від ${-maximum} до ${maximum}`,
    });
  return value;
}

export function coordinates(
  input: Record<string, unknown>,
  latitudeName = "latitude",
  longitudeName = "longitude",
): Coordinates {
  return {
    latitude: coordinate(input[latitudeName], latitudeName, 90),
    longitude: coordinate(input[longitudeName], longitudeName, 180),
  };
}

export function optionalCoordinates(
  input: Record<string, unknown>,
  latitudeName = "delivery_latitude",
  longitudeName = "delivery_longitude",
): Coordinates | undefined {
  if (input[latitudeName] === undefined && input[longitudeName] === undefined) return undefined;
  return coordinates(input, latitudeName, longitudeName);
}
