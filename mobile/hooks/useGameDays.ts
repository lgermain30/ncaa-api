import { useEffect, useMemo, useState } from 'react';

import { fetchGameDays } from '@/lib/api';
import type { Division, Sport } from '@/lib/types';

type Days = Record<string, number>;

const cache = new Map<string, Days>();

/**
 * Game-day counts (YYYY-MM-DD → games) for a board, covering every year that
 * has been requested so far. Results are cached for the app session.
 */
export function useGameDays(sport: Sport, division: Division, years: number[]): Days {
  const board = `${sport}/${division}`;
  const [version, bump] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    for (const year of years) {
      const key = `${board}/${year}`;
      if (cache.has(key)) continue;
      fetchGameDays(sport, division, year, ctrl.signal)
        .then((days) => {
          cache.set(key, days);
          bump((n) => n + 1);
        })
        .catch(() => {});
    }
    return () => ctrl.abort();
  }, [sport, division, board, years]);

  return useMemo(() => {
    const merged: Days = {};
    for (const year of years) Object.assign(merged, cache.get(`${board}/${year}`));
    return merged;
    // `version` is bumped whenever the module cache gains an entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, years, version]);
}
