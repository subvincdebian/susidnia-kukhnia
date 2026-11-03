import type { PGlite } from "@electric-sql/pglite";

// PGlite 0.5.14's worker RPC transports only Error.message. Carry a small,
// controlled code through that channel without exposing SQL, parameters or PII.
const marker = "SUSIDNIA_BROWSER_SQLSTATE:";
const codes = new Set(["23505", "23503", "23514", "P0002", "40001", "40P01"]);
export function workerSqlState(error: unknown): string | undefined {
  if (!(error instanceof Error) || !error.message.startsWith(marker)) return undefined;
  const code = error.message.slice(marker.length);
  return codes.has(code) ? code : undefined;
}
async function workerOperation<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    const details = error && typeof error === "object" ? Object.fromEntries(Object.entries(error)) : {};
    const code = typeof details.code === "string" && codes.has(details.code) ? details.code : "UNKNOWN";
    throw new Error(marker + code);
  }
}
export function protectWorkerSqlErrors(db: Pick<PGlite, "execProtocol" | "execProtocolStream" | "execProtocolRaw" | "execProtocolRawStream">): void {
  const execute = db.execProtocol.bind(db), stream = db.execProtocolStream.bind(db);
  const raw = db.execProtocolRaw.bind(db), rawStream = db.execProtocolRawStream.bind(db);
  db.execProtocol = (...args: Parameters<typeof execute>) => workerOperation(() => execute(...args));
  db.execProtocolStream = (...args: Parameters<typeof stream>) => workerOperation(() => stream(...args));
  db.execProtocolRaw = (...args: Parameters<typeof raw>) => workerOperation(() => raw(...args));
  db.execProtocolRawStream = (...args: Parameters<typeof rawStream>) => workerOperation(() => rawStream(...args));
}
