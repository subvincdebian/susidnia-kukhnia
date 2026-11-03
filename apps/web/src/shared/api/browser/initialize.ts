import type { PGliteInterface } from "@electric-sql/pglite";
import { one } from "./sql.ts";
import { BrowserApiError, object } from "./validation.ts";

export const schemaVersion = 1;
export interface Seed { schemaVersion: number; statements: { sql: string; params: unknown[] }[] }

export function parseSeed(value: unknown): Seed {
  const seed = object(value);
  if (seed.schemaVersion !== schemaVersion || !Array.isArray(seed.statements))
    throw new Error("Unsupported browser data version");
  const statements = seed.statements.map((value: unknown) => {
    const statement = object(value);
    if (typeof statement.sql !== "string" || !Array.isArray(statement.params))
      throw new Error("Invalid browser seed statement");
    return { sql: statement.sql, params: statement.params };
  });
  return { schemaVersion, statements };
}

export async function isInitialized(db: PGliteInterface): Promise<boolean> {
  const marker = await one<{ marker: string | null }>(db, "SELECT to_regclass('public._browser_demo_metadata')::text AS marker");
  if (marker.marker === null) return false;
  const stored = await one<{ schema_version: number }>(db, "SELECT schema_version FROM _browser_demo_metadata WHERE id=1");
  if (stored.schema_version !== schemaVersion)
    throw new BrowserApiError("Збережені дані мають іншу версію. Відкрийте сайт в окремому профілі браузера", {}, 409);
  return true;
}

/** Schema, recorded seed operations and marker commit together; a failed first run is retryable. */
export async function initializeDatabase(db: PGliteInterface, schema: string, seed: Seed): Promise<void> {
  if (await isInitialized(db)) return;
  if (seed.schemaVersion !== schemaVersion) throw new Error("Unsupported browser data version");
  await db.transaction(async (tx) => {
    await tx.exec(schema);
    for (const statement of seed.statements) await tx.query(statement.sql, statement.params);
    await tx.exec("CREATE TABLE _browser_demo_metadata(id integer PRIMARY KEY CHECK(id=1),schema_version integer NOT NULL)");
    await tx.query("INSERT INTO _browser_demo_metadata(id,schema_version) VALUES(1,$1)", [schemaVersion]);
  });
}
