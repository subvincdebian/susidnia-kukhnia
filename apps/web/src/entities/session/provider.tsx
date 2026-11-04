import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { api, ApiError, invalidateResources, subscribeAccessDenied } from "../../shared/api";

export interface SessionUser {
  id: number;
  role: "admin" | "user";
  email: string;
  full_name: string;
  phone: string;
  customer_id: number;
}
export interface Registration {
  email: string;
  password: string;
  full_name: string;
  phone: string;
}
interface SessionValue {
  user: SessionUser | null;
  loading: boolean;
  error: Error | null;
  refresh: () => void;
  login: (email: string, password: string) => Promise<SessionUser>;
  register: (values: Registration) => Promise<SessionUser>;
  logout: () => Promise<void>;
}
const SessionContext = createContext<SessionValue | null>(null);
const updateKey = "susidnia-kukhnia.auth-update";

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const request = useRef<AbortController | null>(null);
  const currentUser = useRef<SessionUser | null>(null);
  const checkSession = useCallback((mask = true) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (mask) setLoading(true);
    setError(null);
    api.get<{ user: SessionUser | null }>("/auth/session", controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return;
        const changed = currentUser.current?.id !== result.user?.id || currentUser.current?.role !== result.user?.role;
        currentUser.current = result.user;
        setUser(result.user);
        setLoading(false);
        if (changed) invalidateResources();
      },
      (failure) => {
        if (controller.signal.aborted) return;
        currentUser.current = null;
        setUser(null);
        setLoading(false);
        setError(failure instanceof Error ? failure : new Error("Не вдалося перевірити вхід"));
      },
    );
  }, []);
  const refresh = useCallback(() => checkSession(), [checkSession]);
  useEffect(() => {
    refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") checkSession(false);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === updateKey || event.key === null) refresh();
    };
    const unsubscribe = subscribeAccessDenied((status) => {
      if (status === 401) {
        request.current?.abort();
        currentUser.current = null;
        setUser(null);
        setLoading(false);
        setError(null);
      } else checkSession(false);
    });
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("storage", onStorage);
    return () => {
      request.current?.abort();
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("storage", onStorage);
    };
  }, [refresh, checkSession]);
  const changed = (next: SessionUser | null) => {
    request.current?.abort();
    currentUser.current = next;
    setUser(next);
    setLoading(false);
    setError(null);
    invalidateResources();
    try {
      localStorage.setItem(updateKey, crypto.randomUUID());
    } catch {
      // A fresh session is checked again when a tab becomes visible.
    }
  };
  const confirmLogin = async () => {
    const result = await api.get<{ user: SessionUser | null }>("/auth/session");
    if (!result.user) throw new ApiError("Браузер не зберіг вхід. Дозволь cookie та повтори спробу", {}, 401);
    changed(result.user);
    return result.user;
  };
  return (
    <SessionContext value={{
      user, loading, error, refresh,
      login: async (email, password) => {
        await api.write<{ user: SessionUser }>("/auth/login", "POST", { email, password });
        return confirmLogin();
      },
      register: async (values) => {
        await api.write<{ user: SessionUser }>("/auth/register", "POST", values);
        return confirmLogin();
      },
      logout: async () => {
        await api.write<{ ok: boolean }>("/auth/logout", "POST", {});
        changed(null);
      },
    }}>
      {children}
    </SessionContext>
  );
}
export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("Акаунт недоступний");
  return value;
}
