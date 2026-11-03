import type { PGliteInterface } from "@electric-sql/pglite";
import { fail } from "./validation.ts";

export type SqlClient = Pick<PGliteInterface, "query" | "exec">;
export type Row = Record<string, unknown>;
export async function rows<T = Row>(db: SqlClient, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}
export async function one<T = Row>(db: SqlClient, sql: string, params: unknown[] = [], message = "Запис не знайдено"): Promise<T> {
  const [row] = await rows<T>(db, sql, params);
  if (!row) fail(404, message);
  return row;
}
export async function page(db: SqlClient, sql: string, params: unknown[], requestedPage: number) {
  const count = await one<{ count: string | number }>(db, `SELECT COUNT(*) AS count FROM (${sql}) counted`, params);
  const total = Number(count.count), size = 10, pages = Math.max(1, Math.ceil(total / size));
  const currentPage = Math.min(requestedPage, pages);
  const items = await rows(db, `${sql} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, size, (currentPage - 1) * size]);
  return { items, total, page: currentPage, pages, size };
}
export function jsonValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, jsonValue(entry)]));
  return value;
}
