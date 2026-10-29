import type { Division, Sport } from '@/lib/types';

type Page = 'standings' | 'leaders' | 'teamStats';

/** Earliest season each source has real data for (checked against the live API). */
const FIRST: Record<Page, Record<Sport, Record<Division, number>>> = {
  standings: {
    'lacrosse-men': { d1: 2000, d2: 2000, d3: 2000 },
    'lacrosse-women': { d1: 2018, d2: 2024, d3: 2024 },
  },
  leaders: {
    'lacrosse-men': { d1: 2000, d2: 2000, d3: 2000 },
    'lacrosse-women': { d1: 2018, d2: 2023, d3: 2023 },
  },
  teamStats: {
    'lacrosse-men': { d1: 2022, d2: 2022, d3: 2022 },
    'lacrosse-women': { d1: 2022, d2: 2022, d3: 2022 },
  },
};

export function firstSeason(page: Page, sport: Sport, division: Division): number {
  return FIRST[page][sport][division];
}

/** Newest first, from `current` back to the page's first season. */
export function seasonsFor(page: Page, sport: Sport, division: Division, current: string): string[] {
  const out: string[] = [];
  for (let y = Number(current); y >= firstSeason(page, sport, division); y--) out.push(String(y));
  return out.length ? out : [current];
}

/** Next spring's season once rosters start posting (July on), else null. */
export function nextSeason(today: string): string | null {
  const [y, m] = today.split('-').map(Number);
  return m >= 7 ? String(y + 1) : null;
}
