import { useCallback, useEffect, useRef, useState } from 'react';

import type { V1Envelope } from '@/lib/types';

export interface V1State<T> {
  data: T | null;
  updatedAt: string | null;
  stale: boolean;
  /** True until the first response (or error) for the current key arrives. */
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

interface Result<T> {
  key: string;
  data: T | null;
  updatedAt: string | null;
  stale: boolean;
  error: string | null;
}

/**
 * Loads a resource, re-fetches on demand and (optionally) on an interval.
 * `key` identifies the resource: results from a different key are never shown,
 * so switching key shows a loading state rather than the previous data.
 */
export function useV1<T>(
  key: string,
  load: (signal: AbortSignal) => Promise<V1Envelope<T>>,
  intervalMs: number | null = null,
): V1State<T> {
  const [result, setResult] = useState<Result<T> | null>(null);
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    const ctrl = new AbortController();
    loadRef
      .current(ctrl.signal)
      .then((env) => {
        setResult({ key, data: env.data, updatedAt: env.meta.updatedAt, stale: env.meta.stale, error: null });
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        const message = err instanceof Error ? err.message : String(err);
        setResult((r) =>
          r && r.key === key ? { ...r, error: message } : { key, data: null, updatedAt: null, stale: false, error: message },
        );
      });
    return () => ctrl.abort();
  }, [key, tick]);

  useEffect(() => {
    if (!intervalMs) return;
    const t = setInterval(() => setTick((n) => n + 1), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs, key]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);
  const current = result && result.key === key ? result : null;
  return {
    data: current?.data ?? null,
    updatedAt: current?.updatedAt ?? null,
    stale: current?.stale ?? false,
    loading: current === null,
    error: current?.error ?? null,
    refresh,
  };
}
