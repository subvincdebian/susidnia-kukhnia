import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly fields: Record<string, string> = {},
    public readonly status = 0,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

let revision = 0;
const listeners = new Set<() => void>();
const accessListeners = new Set<(status: number) => void>();
export function subscribeAccessDenied(listener: (status: number) => void) {
  accessListeners.add(listener);
  return () => { accessListeners.delete(listener); };
}
function reportAccessDenied(path: string, status: number) {
  if (!path.startsWith("/auth/") && (status === 401 || status === 403))
    accessListeners.forEach((listener) => listener(status));
}
export function invalidateResources() {
  revision += 1;
  listeners.forEach((listener) => listener());
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
let session: Promise<void> | undefined;
function prepareSession() {
  session ??= fetch("/api/session", {
    credentials: "same-origin",
    signal: AbortSignal.timeout(15000),
  })
    .then((response) => {
      if (!response.ok)
        throw new ApiError("Не вдалося відкрити сеанс. Оновіть сторінку");
    })
    .catch((error) => {
      session = undefined;
      throw error;
    });
  return session;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (import.meta.env?.MODE === "pages") {
    const browser = await import("./browser/index.ts").catch(() => {
      throw new ApiError("Не вдалося завантажити демоверсію. Оновіть сторінку");
    });
    try {
      return await browser.browserRequest(
        path,
        options.method ?? "GET",
        typeof options.body === "string" ? JSON.parse(options.body) : undefined,
        options.signal ?? undefined,
      ) as T;
    } catch (error) {
      if (error instanceof browser.BrowserApiError) {
        reportAccessDenied(path, error.status);
        throw new ApiError(error.message, error.fields, error.status);
      }
      throw error;
    }
  }
  let response: Response;
  try {
    await prepareSession();
    options.signal?.throwIfAborted();
    response = await fetch(`/api${path}`, {
      ...options,
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...options.headers },
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw error;
    if (error instanceof Error && error.name === "TimeoutError")
      throw new ApiError(
        options.method
          ? "Сервер не відповів. Перевірте список перед повторним збереженням"
          : "Сервер не відповів. Повторіть запит",
      );
    throw new ApiError(
      "Немає зв'язку із сервером. Перевірте, чи запущено застосунок",
    );
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    let message = "Не вдалося виконати запит. Спробуйте ще раз";
    const fields: Record<string, string> = {};
    if (body && typeof body === "object") {
      if ("message" in body && typeof body.message === "string")
        message = body.message;
      if ("fields" in body && body.fields && typeof body.fields === "object") {
        for (const [key, value] of Object.entries(body.fields))
          if (typeof value === "string") fields[key] = value;
      }
    }
    reportAccessDenied(path, response.status);
    throw new ApiError(message, fields, response.status);
  }
  return response.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
  async write<T>(
    path: string,
    method: "POST" | "PATCH" | "DELETE",
    body: unknown,
  ): Promise<T> {
    const result = await request<T>(path, {
      method,
      body: JSON.stringify(body),
    });
    invalidateResources();
    return result;
  },
};

export interface Resource<T> {
  data: T | undefined;
  error: Error | null;
  loading: boolean;
  retry: () => void;
}

export function useResource<T>(path: string | null): Resource<T> {
  const currentRevision = useSyncExternalStore(subscribe, () => revision);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    path: string | null;
    data?: T;
    error: Error | null;
    loading: boolean;
  }>({ path, error: null, loading: Boolean(path) });
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    setState((previous) => ({
      path,
      data: previous.path === path ? previous.data : undefined,
      error: null,
      loading: true,
    }));
    api.get<T>(path, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted)
          setState({ path, data, error: null, loading: false });
      },
      (error) => {
        if (!controller.signal.aborted)
          setState((previous) => ({
            ...previous,
            path,
            data: error instanceof ApiError && [401, 403, 404].includes(error.status) ? undefined : previous.data,
            error:
              error instanceof Error
                ? error
                : new Error("Не вдалося завантажити дані"),
            loading: false,
          }));
      },
    );
    return () => controller.abort();
  }, [path, currentRevision, attempt]);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return {
    data: state.path === path ? state.data : undefined,
    error: state.path === path ? state.error : null,
    loading: state.path !== path || state.loading,
    retry,
  };
}
