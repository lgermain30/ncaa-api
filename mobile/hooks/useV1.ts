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

const RETRY_DELAYS_MS = [1000, 3000, 8000];

/** Network-level failures (no response at all) are retried; HTTP errors are not. */
function isTransient(err: unknown): boolean {
  return err instanceof TypeError || (err instanceof Error && /network|fetch failed|timed out/i.test(err.message));
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    });
  });

async function loadWithRetry<T>(load: () => Promise<T>, signal: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await load();
    } catch (err) {
      if (signal.aborted || attempt >= RETRY_DELAYS_MS.length || !isTransient(err)) throw err;
      await sleep(RETRY_DELAYS_MS[attempt], signal);
      if (signal.aborted) throw err;
    }
  }
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
    loadWithRetry(() => loadRef.current(ctrl.signal), ctrl.signal)
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
