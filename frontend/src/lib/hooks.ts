"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { errorMessage } from "@/lib/api";

interface Loaded<T> { key: string; tick: number; data: T | null; error: string | null }

/**
 * Load data for the given dependency key. `loading` is derived (requested key/tick differs from the loaded one),
 * so no state is set synchronously inside effects. Keeps previous data visible while reloading.
 */
export function useData<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const key = JSON.stringify(deps);
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<Loaded<T>>({ key: "\u0000", tick: -1, data: null, error: null });
  const fn = useRef(loader);
  const waiters = useRef<(() => void)[]>([]);
  useLayoutEffect(() => {
    fn.current = loader;
  });

  useEffect(() => {
    let live = true;
    fn.current().then(
      (data) => live && setState({ key, tick, data, error: null }),
      (e) => live && setState((s) => ({ key, tick, data: s.data, error: errorMessage(e) })),
    ).finally(() => {
      if (!live) return;
      const w = waiters.current;
      waiters.current = [];
      w.forEach((r) => r());
    });
    return () => {
      live = false;
    };
  }, [key, tick]);

  const reload = useCallback(() => new Promise<void>((resolve) => {
    waiters.current.push(resolve);
    setTick((t) => t + 1);
  }), []);
  const setData = useCallback((d: T) => setState((s) => ({ ...s, data: d })), []);

  return { data: state.data, error: state.error, loading: state.key !== key || state.tick !== tick, reload, setData };
}
