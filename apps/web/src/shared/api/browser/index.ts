import { createBrowserApi } from "./core.ts";
import { geoRequest } from "./geo.ts";
import { BrowserApiError } from "./validation.ts";
import { openDatabaseWorker } from "./worker-startup.ts";
export { BrowserApiError } from "./validation.ts";

let apiPromise: Promise<ReturnType<typeof createBrowserApi>> | undefined;
function databaseApi() {
  apiPromise ??= (async () => {
    const base = new URL(import.meta.env.BASE_URL, window.location.origin);
    const scope = encodeURIComponent(base.pathname);
    const worker = new Worker(new URL("./database.worker.ts", import.meta.url), { type: "module" });
    const db = await openDatabaseWorker(worker, {
      dataDir: `idb://susidnia-kukhnia-${scope}`,
      id: `susidnia-kukhnia-${scope}`,
      meta: { schemaUrl: new URL("demo/schema.sql", base).href, seedUrl: new URL("demo/seed.json", base).href },
    });
    return createBrowserApi(db);
  })().catch(() => {
    apiPromise = undefined;
    throw new BrowserApiError("Не вдалося відкрити дані браузера. Перевірте доступ до сховища та повторіть спробу", {}, 503);
  });
  return apiPromise;
}

export async function browserRequest(path: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<unknown> {
  signal?.throwIfAborted();
  if (method.toUpperCase() === "GET" && path.startsWith("/geo/")) {
    const result = await geoRequest(path, signal);
    signal?.throwIfAborted();
    return result;
  }
  const api = await databaseApi();
  signal?.throwIfAborted();
  const result = await api.request(path, method, body);
  signal?.throwIfAborted();
  return result;
}
