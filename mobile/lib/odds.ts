import type { V1Game } from './types';

const point = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/** "Syracuse -2.5" (the favorite), "Pick'em" for an even line, null when no book posted one. */
export function spreadLabel(game: V1Game): string | null {
  const s = game.odds?.spread;
  if (!s) return null;
  if (s.home === 0 && s.away === 0) return "Pick'em";
  const fav = s.home < 0 ? game.home : game.away;
  return `${fav.shortName || fav.name} ${point(Math.min(s.home, s.away))}`;
}
