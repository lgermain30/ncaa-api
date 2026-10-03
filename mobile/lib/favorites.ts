import { kv } from './kv';
import { useEffect, useState } from 'react';

import type { Division, Sport } from './types';

/** A team the visitor follows; enough to open its page and match it on game rows. */
export interface FollowedTeam {
  id: string;
  name: string;
  seoName: string | null;
  sport: Sport;
  division: Division;
}

export interface Follows {
  favorite: FollowedTeam | null;
  watching: FollowedTeam[];
}

const KEY = 'cln.follows.v1';
const EMPTY: Follows = { favorite: null, watching: [] };

function load(): Follows {
  try {
    const raw = kv.get(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<Follows>;
    return { favorite: parsed.favorite ?? null, watching: parsed.watching ?? [] };
  } catch {
    return EMPTY;
  }
}

let state: Follows = load();
const listeners = new Set<(f: Follows) => void>();

function set(next: Follows) {
  state = next;
  try {
    kv.set(KEY, JSON.stringify(next));
  } catch {
    // storage unavailable (web preview): keep in memory only
  }
  for (const l of listeners) l(next);
}

export const teamKey = (t: { seoName?: string | null; name: string; id?: string | null }) =>
  (t.seoName ?? '').toLowerCase() || t.name.toLowerCase();

const same = (a: FollowedTeam, b: FollowedTeam) =>
  a.sport === b.sport && a.division === b.division && teamKey(a) === teamKey(b);

export function setFavorite(team: FollowedTeam | null) {
  set({
    favorite: team,
    watching: team ? state.watching.filter((w) => !same(w, team)) : state.watching,
  });
}

export function toggleWatch(team: FollowedTeam) {
  const on = state.watching.some((w) => same(w, team));
  set({
    favorite: on || !state.favorite || !same(state.favorite, team) ? state.favorite : null,
    watching: on ? state.watching.filter((w) => !same(w, team)) : [...state.watching, team],
  });
}

export function useFollows(): Follows {
  const [f, setF] = useState(state);
  useEffect(() => {
    listeners.add(setF);
    return () => {
      listeners.delete(setF);
    };
  }, []);
  return f;
}

/** Every followed team (favorite first) on one sport/division board. */
export function followedOn(f: Follows, sport: Sport, division: Division): FollowedTeam[] {
  const all = f.favorite ? [f.favorite, ...f.watching] : f.watching;
  return all.filter((t) => t.sport === sport && t.division === division);
}

export const isFavorite = (f: Follows, t: FollowedTeam) => !!f.favorite && same(f.favorite, t);
export const isWatching = (f: Follows, t: FollowedTeam) => f.watching.some((w) => same(w, t));
