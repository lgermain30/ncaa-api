import type {
  ConferenceStandings,
  Division,
  Sport,
  V1Boxscore,
  V1Envelope,
  V1Game,
  V1Plays,
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

export async function fetchStandings(
  season: string,
  signal?: AbortSignal,
): Promise<ConferenceStandings[]> {
  const res = await fetch(`${API_BASE}/official-standings?season=${season}`, { signal });
  if (!res.ok) throw new ApiError(res.status, `${res.status} standings`);
  return (await res.json()) as ConferenceStandings[];
}

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
