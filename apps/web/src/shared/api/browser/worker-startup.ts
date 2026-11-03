import { PGliteWorker, type PGliteWorkerOptions } from "@electric-sql/pglite/worker";
import { parseKyivTimestamp } from "./timestamps.ts";
import { BrowserApiError } from "./validation.ts";

const messageType = "susidnia-browser-startup";
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? Object.fromEntries(Object.entries(value)) : {};
}
const unavailable = () => new BrowserApiError("Не вдалося відкрити дані браузера. Перевірте доступ до сховища та повторіть спробу", {}, 503);

/** Hold the upstream ready message: 0.5.14 starts an uncancellable connection loop on it, before its init() finishes. */
export async function openDatabaseWorker(worker: Worker, options: PGliteWorkerOptions, timeoutMs = 60000): Promise<PGliteWorker> {
  let pendingReady: unknown, pendingLeader: unknown, databaseReady = false;
  let rejectStartup: (reason: BrowserApiError) => void = () => {};
  const failure = new Promise<never>((_resolve, reject) => { rejectStartup = reject; });
  const onMessage = (event: MessageEvent<unknown>) => {
    const data = record(event.data);
    if (data.type === "ready" && !databaseReady) {
      event.stopImmediatePropagation();
      pendingReady = event.data;
    }
    if (data.type === "leader-now" && !databaseReady) {
      event.stopImmediatePropagation();
      pendingLeader = event.data;
    }
    if (data.type !== messageType) return;
    if (data.state === "failed") rejectStartup(unavailable());
    if (data.state === "ready") {
      databaseReady = true;
      if (pendingReady !== undefined) {
        const ready = pendingReady;
        pendingReady = undefined;
        worker.dispatchEvent(new MessageEvent("message", { data: ready }));
      }
    }
  };
  const onError = () => { rejectStartup(unavailable()); };
  worker.addEventListener("message", onMessage, { capture: true });
  worker.addEventListener("error", onError);
  worker.addEventListener("messageerror", onError);
  const timer = setTimeout(onError, timeoutMs);
  let db: PGliteWorker | undefined;
  try {
    const client = new PGliteWorker(worker, options);
    db = client;
    // Parser functions cannot be structured-cloned through worker options.
    client.parsers[1114] = parseKyivTimestamp;
    await Promise.race([client.waitReady.then(() => client.query("SELECT 1")), failure]);
    if (pendingLeader !== undefined) worker.dispatchEvent(new MessageEvent("message", { data: pendingLeader }));
    return client;
  } catch {
    if (db) await db.close();
    else worker.terminate();
    throw unavailable();
  } finally {
    clearTimeout(timer);
    worker.removeEventListener("message", onMessage, { capture: true });
    worker.removeEventListener("error", onError);
    worker.removeEventListener("messageerror", onError);
  }
}

/** A late follower asks the elected leader for its state; it must not miss a one-time ready broadcast. */
export function workerStartupReporter() {
  let channel: BroadcastChannel | undefined;
  let state: "pending" | "ready" | "failed" = "pending";
  const send = (current: "ready" | "failed") => globalThis.postMessage({ type: messageType, state: current });
  globalThis.addEventListener("message", (event: MessageEvent<unknown>) => {
    const data = record(event.data), options = record(data.options);
    if (data.type !== "init" || typeof options.id !== "string") return;
    channel = new BroadcastChannel(`${messageType}:${options.id}`);
    channel.addEventListener("message", (event: MessageEvent<unknown>) => {
      const data = record(event.data);
      if (data.type === "probe" && state !== "pending") channel?.postMessage({ type: "state", state });
      if (data.type === "state" && (data.state === "ready" || data.state === "failed")) send(data.state);
    });
    channel.postMessage({ type: "probe" });
  }, { once: true });
  return {
    ready() { state = "ready"; channel?.postMessage({ type: "state", state }); send(state); },
    failed() { state = "failed"; channel?.postMessage({ type: "state", state }); send(state); },
  };
}
