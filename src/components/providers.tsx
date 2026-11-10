"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";
import { api } from "@/lib/api";
import type { Me } from "@/lib/types";
import { cx } from "@/lib/format";

// ---- toasts ---------------------------------------------------------------------
type ToastKind = "success" | "error" | "info";
interface Toast { id: number; kind: ToastKind; text: string }
const ToastCtx = createContext<(kind: ToastKind, text: string) => void>(() => {});

function ToastHost({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = useCallback((kind: ToastKind, text: string) => {
    const id = ++seq.current;
    setItems((x) => [...x.slice(-3), { id, kind, text }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === "error" ? 7000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="no-print pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className={cx(
              "animate-rise pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border bg-white px-4 py-3 text-sm shadow-[var(--shadow-pop)]",
              t.kind === "error" ? "border-danger/30" : t.kind === "success" ? "border-ok/30" : "border-silver",
            )}
          >
            {t.kind === "success" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" /> : t.kind === "error" ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" /> : <Info className="mt-0.5 size-4 shrink-0 text-violet-700" />}
            <p className="flex-1 text-ink">{t.text}</p>
            <button aria-label="Dismiss" onClick={() => setItems((x) => x.filter((y) => y.id !== t.id))} className="text-slate hover:text-ink">
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const push = useContext(ToastCtx);
  return useMemo(() => ({ success: (t: string) => push("success", t), error: (t: string) => push("error", t), info: (t: string) => push("info", t) }), [push]);
}

// ---- auth -------------------------------------------------------------------------
interface AuthState {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<Me | null>;
  setMe: (m: Me | null) => void;
  can: (perm: string) => boolean;
  logout: () => Promise<void>;
}
const AuthCtx = createContext<AuthState>({ me: null, loading: true, refresh: async () => null, setMe: () => {}, can: () => false, logout: async () => {} });

function AuthHost({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      const m = await api.get<Me>("/auth/me");
      setMe(m);
      return m;
    } catch {
      setMe(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const p = window.location.pathname;
    if (p.startsWith("/book/") || p.startsWith("/r/") || p === "/login" || p === "/forgot-password" || p === "/reset-password") return;
    let live = true;
    api.get<Me>("/auth/me").then(
      (m) => live && setMe(m),
      () => live && setMe(null),
    ).finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);
  const can = useCallback((perm: string) => !!me?.permissions.includes(perm), [me]);
  const logout = useCallback(async () => {
    await api.post("/auth/logout").catch(() => {});
    setMe(null);
    // Full reload on purpose: clears every cached screen and in-memory patient data after sign-out.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
  }, []);
  return <AuthCtx.Provider value={{ me, loading, refresh, setMe, can, logout }}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  return useContext(AuthCtx);
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ToastHost>
      <AuthHost>{children}</AuthHost>
    </ToastHost>
  );
}
