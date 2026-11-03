import { PGlite } from "@electric-sql/pglite";
import { worker } from "@electric-sql/pglite/worker";
import { initializeDatabase, isInitialized, parseSeed } from "./initialize.ts";
import { object } from "./validation.ts";
import { workerStartupReporter } from "./worker-startup.ts";
import { protectWorkerSqlErrors } from "./worker-errors.ts";

const startup = workerStartupReporter();

function assetUrl(value: unknown): URL {
  if (typeof value !== "string") throw new Error("Missing browser data asset");
  const url = new URL(value);
  if (url.origin !== globalThis.location.origin || url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error("Invalid browser data asset");
  return url;
}

await worker({
  async init(options) {
    let db: PGlite | undefined;
    try {
      db = await PGlite.create({ dataDir: options.dataDir });
      await db.exec("SET timezone='Europe/Kyiv'");
      if (!await isInitialized(db)) {
        const meta: unknown = options.meta;
        const assets = object(meta);
        const [schemaResponse, seedResponse] = await Promise.all([
          fetch(assetUrl(assets.schemaUrl), { signal: AbortSignal.timeout(30000) }),
          fetch(assetUrl(assets.seedUrl), { signal: AbortSignal.timeout(30000) }),
        ]);
        if (!schemaResponse.ok || !seedResponse.ok) throw new Error("Browser data assets unavailable");
        const schema = await schemaResponse.text(), seed: unknown = await seedResponse.json();
        await initializeDatabase(db, schema, parseSeed(seed));
      }
      protectWorkerSqlErrors(db);
      startup.ready();
      return db;
    } catch {
      startup.failed();
      await db?.close();
      throw new Error("Browser database startup failed");
    }
  },
}).catch(() => { startup.failed(); });
