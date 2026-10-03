import { useEffect, useState } from 'react';

import { kv } from './kv';
import type { Division, Sport } from './types';

/** A team the visitor follows; enough to open its page and match it on game rows. */
export interface FollowedTeam {
  id: string;
  name: string;
  seoName: string | null;
  sport: Sport;
  division: Division;
}

/** One favorite per sport (men's / women's) plus up to MAX_WATCH watched teams per sport. */
export interface Follows {
  favorites: FollowedTeam[];
  watching: FollowedTeam[];
}

export const MAX_WATCH = 6;

const KEY = 'cln.follows.v2';
const LEGACY_KEY = 'cln.follows.v1';
const EMPTY: Follows = { favorites: [], watching: [] };

function load(): Follows {
  try {
    const raw = kv.get(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Follows>;
      return { favorites: p.favorites ?? [], watching: p.watching ?? [] };
    }
    const legacy = kv.get(LEGACY_KEY);
    if (legacy) {
      const p = JSON.parse(legacy) as { favorite?: FollowedTeam | null; watching?: FollowedTeam[] };
      return { favorites: p.favorite ? [p.favorite] : [], watching: p.watching ?? [] };
    }
  } catch {
    // corrupt or unavailable storage: start empty
  }
  return EMPTY;
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

export const favoriteFor = (f: Follows, sport: Sport) =>
  f.favorites.find((t) => t.sport === sport) ?? null;

/** Make `team` the favorite for its sport (replacing the previous one); `null` + sport clears it. */
export function setFavorite(team: FollowedTeam | null, sport?: Sport) {
  const s = team?.sport ?? sport;
  set({
    favorites: [...state.favorites.filter((t) => t.sport !== s), ...(team ? [team] : [])],
    watching: team ? state.watching.filter((w) => !same(w, team)) : state.watching,
  });
}

/** Add/remove a watched team. Returns false when the per-sport limit is reached. */
export function toggleWatch(team: FollowedTeam): boolean {
  const on = state.watching.some((w) => same(w, team));
  if (!on && state.watching.filter((w) => w.sport === team.sport).length >= MAX_WATCH) return false;
  set({
    favorites: state.favorites.filter((t) => !same(t, team)),
    watching: on ? state.watching.filter((w) => !same(w, team)) : [...state.watching, team],
  });
  return true;
}

export function clearFollows() {
  set(EMPTY);
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
  return [...f.favorites, ...f.watching].filter((t) => t.sport === sport && t.division === division);
}

/** Board to open the app on: the men's favorite, else the women's, else men's D1. */
export function homeBoard(f: Follows): { sport: Sport; division: Division } {
  const t = favoriteFor(f, 'lacrosse-men') ?? favoriteFor(f, 'lacrosse-women');
  return t ? { sport: t.sport, division: t.division } : { sport: 'lacrosse-men', division: 'd1' };
}

export const isFavorite = (f: Follows, t: FollowedTeam) => f.favorites.some((x) => same(x, t));
export const isWatching = (f: Follows, t: FollowedTeam) => f.watching.some((w) => same(w, t));

export type Highlight = 'favorite' | 'watching' | null;

/** How a team on a board should be highlighted, given the keys of favorites and watched teams there. */
export function highlightFor(
  team: { seoName?: string | null; name: string },
  favKeys: Set<string>,
  watchKeys: Set<string>,
): Highlight {
  const k = teamKey(team);
  return favKeys.has(k) ? 'favorite' : watchKeys.has(k) ? 'watching' : null;
}

export function boardKeys(f: Follows, sport: Sport, division: Division) {
  const on = (list: FollowedTeam[]) =>
    new Set(list.filter((t) => t.sport === sport && t.division === division).map(teamKey));
  return { favKeys: on(f.favorites), watchKeys: on(f.watching) };
}
