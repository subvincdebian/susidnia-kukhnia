import type { PGliteInterface } from "@electric-sql/pglite";
import { one, type SqlClient } from "./sql.ts";
import { BrowserApiError, object } from "./validation.ts";

export const schemaVersion = 2;
interface Statement { sql: string; params: unknown[] }
export interface Seed { schemaVersion: number; statements: Statement[]; upgrade?: { fromVersion: number; schema: string; statements: Statement[] } }

function parseStatements(value: unknown): Statement[] {
  if (!Array.isArray(value)) throw new Error("Invalid browser seed statements");
  return value.map((value: unknown) => {
    const statement = object(value);
    if (typeof statement.sql !== "string" || !Array.isArray(statement.params)) throw new Error("Invalid browser seed statement");
    return { sql: statement.sql, params: statement.params };
  });
}

export function parseSeed(value: unknown): Seed {
  const seed = object(value);
  if (seed.schemaVersion !== schemaVersion || !Array.isArray(seed.statements))
    throw new Error("Unsupported browser data version");
  const statements = parseStatements(seed.statements);
  if (seed.upgrade === undefined) return { schemaVersion, statements };
  const upgrade = object(seed.upgrade);
  if (upgrade.fromVersion !== 1 || typeof upgrade.schema !== "string") throw new Error("Invalid browser upgrade");
  return { schemaVersion, statements, upgrade: { fromVersion: 1, schema: upgrade.schema, statements: parseStatements(upgrade.statements) } };
}

async function storedVersion(db: SqlClient): Promise<number | null> {
  const marker = await one<{ marker: string | null }>(db, "SELECT to_regclass('public._browser_demo_metadata')::text AS marker");
  if (marker.marker === null) return null;
  const stored = await one<{ schema_version: number }>(db, "SELECT schema_version FROM _browser_demo_metadata WHERE id=1");
  if (stored.schema_version !== 1 && stored.schema_version !== schemaVersion)
    throw new BrowserApiError("Збережені дані мають іншу версію. Відкрийте сайт в окремому профілі браузера", {}, 409);
  return stored.schema_version;
}
export async function isInitialized(db: PGliteInterface): Promise<boolean> {
  return await storedVersion(db) === schemaVersion;
}

/** Schema, recorded seed operations and marker commit together; a failed first run is retryable. */
export async function initializeDatabase(db: PGliteInterface, schema: string, seed: Seed): Promise<void> {
  if (await isInitialized(db)) return;
  if (seed.schemaVersion !== schemaVersion) throw new Error("Unsupported browser data version");
  await db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(718202628)");
    const version = await storedVersion(tx);
    if (version === schemaVersion) return;
    if (version === null) {
      await tx.exec(schema);
      for (const statement of seed.statements) await tx.query(statement.sql, statement.params);
      await tx.exec("CREATE TABLE _browser_demo_metadata(id integer PRIMARY KEY CHECK(id=1),schema_version integer NOT NULL)");
      await tx.query("INSERT INTO _browser_demo_metadata(id,schema_version) VALUES(1,$1)", [schemaVersion]);
    } else {
      if (!seed.upgrade || seed.upgrade.fromVersion !== version) throw new Error("Browser upgrade unavailable");
      await tx.exec(seed.upgrade.schema);
      for (const statement of seed.upgrade.statements) await tx.query(statement.sql, statement.params);
      await tx.query("UPDATE _browser_demo_metadata SET schema_version=$1 WHERE id=1", [schemaVersion]);
    }
  });
}
