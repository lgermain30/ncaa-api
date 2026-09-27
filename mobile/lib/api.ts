import type {
  ConferenceStandings,
  Division,
  Sport,
  V1Boxscore,
  V1Envelope,
  V1Game,
  V1Plays,
  V1TeamDetail,
  V1TeamSeasonStats,
  V1TeamSummary,
  LeaderBoards,
  V1NewsItem,
} from './types';

export const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE ?? 'https://ncaa-api-production-1586.up.railway.app';

export const SPORTS: { key: Sport; label: string }[] = [
  { key: 'lacrosse-men', label: "Men's" },
  { key: 'lacrosse-women', label: "Women's" },
];

export const DIVISIONS: { key: Division; label: string }[] = [
  { key: 'd1', label: 'DI' },
  { key: 'd2', label: 'DII' },
  { key: 'd3', label: 'DIII' },
];

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const etags = new Map<string, { etag: string; body: unknown }>();

/**
 * GET a /v1 route. Reuses the ETag we last saw for the URL so a 304 costs no
 * body transfer; the cached body is returned in that case.
 */
export async function getV1<T>(path: string, signal?: AbortSignal): Promise<V1Envelope<T>> {
  const url = `${API_BASE}${path}`;
  const cached = etags.get(url);
  const res = await fetch(url, {
    signal,
    headers: cached ? { 'If-None-Match': cached.etag } : undefined,
  });
  if (res.status === 304 && cached) return cached.body as V1Envelope<T>;
  if (!res.ok) throw new ApiError(res.status, `${res.status} ${path}`);
  const body = (await res.json()) as V1Envelope<T>;
  const etag = res.headers.get('etag');
  if (etag) etags.set(url, { etag, body });
  return body;
}

export const fetchGames = (sport: Sport, division: Division, date: string, signal?: AbortSignal) =>
  getV1<V1Game[]>(`/v1/games/${sport}/${division}/${date}`, signal);

export const fetchLive = (signal?: AbortSignal) => getV1<V1Game[]>('/v1/live', signal);

export const fetchGame = (id: string, signal?: AbortSignal) =>
  getV1<V1Game>(`/v1/game/${id}`, signal);

export const fetchBoxscore = (id: string, signal?: AbortSignal) =>
  getV1<V1Boxscore | null>(`/v1/game/${id}/boxscore`, signal);

export const fetchPlays = (id: string, signal?: AbortSignal) =>
  getV1<V1Plays | null>(`/v1/game/${id}/plays`, signal);

export const fetchTeams = (sport: Sport, division: Division, signal?: AbortSignal) =>
  getV1<V1TeamSummary[]>(`/v1/teams/${sport}/${division}`, signal);

/** `id` may be a lax.com url_name, an NCAA seoName or a display name. */
export const fetchTeam = (sport: Sport, division: Division, id: string, season?: string, signal?: AbortSignal) =>
  getV1<V1TeamDetail>(
    `/v1/teams/${sport}/${division}/${encodeURIComponent(id)}${season ? `?season=${season}` : ''}`,
    signal,
  );

interface LaxStandingsTeam {
  name: string;
  wins: string;
  losses: string;
  conf_wins: number;
  conf_losses: number;
  goals_for?: string;
  goals_against?: string;
}

interface LaxStandingsConference {
  conference: { name: string; id: string };
  conf_leaderboard: LaxStandingsTeam[];
}

function teamKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(university|college|the|of|at)\b/g, '')
    .replace(/^u(?=[a-z])/, '')
    .replace(/[^a-z0-9]/g, '');
}

/** Streak (and official conference record) per team, from conference-published standings. Best effort. */
async function fetchOfficialExtras(
  season: string,
  signal?: AbortSignal,
): Promise<Map<string, { streak: string; conferenceRecord: string }>> {
  const out = new Map<string, { streak: string; conferenceRecord: string }>();
  try {
    const res = await fetch(`${API_BASE}/official-standings?season=${season}`, { signal });
    if (!res.ok) return out;
    const confs = (await res.json()) as ConferenceStandings[];
    for (const c of confs) {
      const rows = c.standings ?? [];
      const sane = rows.every((r) => /^\d+-\d+$/.test(r.conferenceRecord) && /^[WL]\d+$/.test(r.streak ?? ''));
      if (!sane) continue;
      for (const r of rows) out.set(teamKey(r.team), { streak: r.streak, conferenceRecord: r.conferenceRecord });
    }
  } catch {
    // official sources are scraped and flaky; lax.com data stands on its own
  }
  return out;
}

export async function fetchStandings(
  sport: Sport,
  division: Division,
  season: string,
  signal?: AbortSignal,
): Promise<ConferenceStandings[]> {
  const official = sport === 'lacrosse-men' && division === 'd1';
  const [res, extras] = await Promise.all([
    fetch(`${API_BASE}/standings/${sport}/${division}?season=${season}`, { signal }),
    official ? fetchOfficialExtras(season, signal) : Promise.resolve(new Map<string, { streak: string; conferenceRecord: string }>()),
  ]);
  if (!res.ok) throw new ApiError(res.status, `${res.status} standings`);
  const body: unknown = await res.json();

  const conferences = (typeof body === 'string' ? JSON.parse(body) : body) as LaxStandingsConference[];
  return conferences.map((c) => ({
    conference: c.conference.name,
    slug: c.conference.id,
    logo: '',
    season,
    count: c.conf_leaderboard.length,
    standings: c.conf_leaderboard.map((r) => {
      const name = r.name.replace(/(^|[\s(-])([a-z])/g, (_, prefix: string, letter: string) => prefix + letter.toUpperCase());
      const extra = extras.get(teamKey(name));
      return {
        team: name,
        conferenceRecord: extra?.conferenceRecord ?? `${r.conf_wins}-${r.conf_losses}`,
        overallRecord: `${r.wins}-${r.losses}`,
        overallPct: '',
        home: '',
        away: '',
        neutral: '',
        goalsForAgainst: r.goals_for != null && r.goals_against != null ? `${r.goals_for}-${r.goals_against}` : '',
        streak: extra?.streak ?? '',
      };
    }),
  }));
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { signal });
  if (!res.ok) throw new ApiError(res.status, `${res.status} ${path}`);
  return (await res.json()) as T;
}

/** Team logo (SVG) served by the API for a team's NCAA seoName. */
export const logoUrl = (seoName: string) => `${API_BASE}/logo/${seoName}`;

/**
 * Dates (YYYY-MM-DD) with at least one game, with counts. NCAA keys schedules by
 * season year, which can straddle the calendar year, so both the calendar year
 * and the previous one are merged.
 */
export async function fetchGameDays(
  sport: Sport,
  division: Division,
  year: number,
  signal?: AbortSignal,
): Promise<Record<string, number>> {
  interface Resp {
    data?: { schedules?: { games?: { count: number; contestDate: string }[] } };
  }
  const days: Record<string, number> = {};
  await Promise.all(
    [year, year - 1].map(async (y) => {
      const res = await fetch(`${API_BASE}/schedule-alt/${sport}/${division}/${y}`, { signal });
      if (!res.ok) return;
      const body = (await res.json()) as Resp;
      for (const g of body.data?.schedules?.games ?? []) {
        const [mm, dd, yyyy] = g.contestDate.split('/');
        if (mm && dd && yyyy) days[`${yyyy}-${mm}-${dd}`] = g.count;
      }
    }),
  );
  return days;
}

export const fetchLeaders = (sport: Sport, division: Division, season: string, signal?: AbortSignal) =>
  getJson<LeaderBoards>(`/lax-stats/${sport}/${division}?season=${season}`, signal);

export const fetchTeamStats = (sport: Sport, division: Division, season: string, signal?: AbortSignal) =>
  getV1<V1TeamSeasonStats[]>(`/v1/team-stats/${sport}/${division}?season=${season}`, signal);

export const fetchNews = (signal?: AbortSignal) => getV1<V1NewsItem[]>('/v1/news', signal);

export function streamUrl(filter: { sport?: Sport; division?: Division; date?: string; game?: string }) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(filter)) if (v) q.set(k, v);
  const qs = q.toString();
  return `${API_BASE}/v1/stream${qs ? `?${qs}` : ''}`;
}

/** Today's date in US Eastern time as YYYY-MM-DD — NCAA game days are ET days. */
export function todayEt(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Lacrosse season year for a date: Jan–Jul games belong to that calendar year. */
export function seasonFor(date: string): string {
  return date.slice(0, 4);
}
