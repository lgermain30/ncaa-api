// Mirrors ncaa-api/src/v1/types.ts — the public /v1 contract.

export type GameState = 'pre' | 'live' | 'final' | 'postponed' | 'canceled';

export type Sport = 'lacrosse-men' | 'lacrosse-women';
export type Division = 'd1' | 'd2' | 'd3';

export interface V1Team {
  id: string | null;
  name: string;
  shortName: string;
  seoName: string;
  char6: string;
  color: string | null;
  score: number | null;
  rank: number | null;
  seed: number | null;
  record: string | null;
  conference: string | null;
  isWinner: boolean;
}

export interface V1Linescore {
  period: string;
  home: number | null;
  away: number | null;
}

export interface V1GameStatus {
  state: GameState;
  period: string;
  clock: string;
  display: string;
  finalMessage: string;
}

export interface V1Venue {
  name: string;
  city: string;
  state: string;
}

export interface V1Game {
  id: string;
  sport: Sport;
  division: Division;
  date: string;
  startEpoch: number | null;
  startTime: string;
  status: V1GameStatus;
  home: V1Team;
  away: V1Team;
  linescore: V1Linescore[];
  linescoreSource: 'ncaa' | 'pbp';
  venue: V1Venue | null;
  broadcast: { network: string | null; liveVideo: boolean };
  attendance: number | null;
  bracket: {
    championshipId: number | null;
    bracketId: number | null;
    round: number | null;
    roundDescription: string | null;
  } | null;
  links: { ncaa: string | null };
  detailed: boolean;
  updatedAt: string;
}

export interface V1PlayerLine {
  teamId: string;
  name: string;
  firstName: string;
  lastName: string;
  number: number | null;
  position: string;
  starter: boolean;
  played: boolean;
  goals: number;
  assists: number;
  points: number;
  shots: number;
  shotsOnGoal: number;
  groundBalls: number;
  turnovers: number;
  causedTurnovers: number;
  drawControls: number;
  faceoffsWon: number | null;
  faceoffsTaken: number | null;
  saves: number | null;
  goalsAllowed: number | null;
  isGoalie: boolean;
  penalties: { count: number; minutes: number } | null;
}

export interface V1TeamLine {
  teamId: string;
  goals: number;
  assists: number;
  shots: number;
  shotsOnGoal: number;
  groundBalls: number;
  turnovers: number;
  causedTurnovers: number;
  drawControls: number | null;
  faceoffsWon: number | null;
  faceoffsLost: number | null;
  clears: number | null;
  clearAttempts: number | null;
  saves: number | null;
  goalsAllowed: number | null;
  penalties: { count: number; minutes: number } | null;
  extraMan: { goals: number; opportunities: number } | null;
}

export interface V1BoxTeam {
  teamId: string;
  isHome: boolean;
  name: string;
  shortName: string;
}

export interface V1Boxscore {
  gameId: string;
  status: { state: GameState; period: string; clock: string };
  teams: V1BoxTeam[];
  teamStats: V1TeamLine[];
  players: V1PlayerLine[];
  derived: { faceoffs: 'pbp' | 'none'; saves: 'pbp' | 'none'; clears: 'pbp' | 'none' };
  updatedAt: string;
}

export type PlayType =
  | 'goal'
  | 'shot'
  | 'save'
  | 'faceoff'
  | 'groundball'
  | 'turnover'
  | 'clear'
  | 'penalty'
  | 'timeout'
  | 'period'
  | 'lineup'
  | 'other';

export interface V1Play {
  id: string;
  period: number;
  periodDisplay: string;
  clock: string;
  teamId: string | null;
  type: PlayType;
  text: string;
  homeScore: number | null;
  awayScore: number | null;
  scorer: string | null;
  assist: string | null;
  tags: string[];
}

export interface V1Plays {
  gameId: string;
  status: { state: GameState; period: string; clock: string };
  teams: V1BoxTeam[];
  plays: V1Play[];
  updatedAt: string;
}

export interface V1Envelope<T> {
  data: T;
  meta: { updatedAt: string; stale: boolean };
}

export type GameEventType =
  | 'game.new'
  | 'game.state'
  | 'game.score'
  | 'game.clock'
  | 'game.linescore'
  | 'game.details';

export interface GameEvent {
  id: number;
  type: GameEventType;
  at: string;
  gameId: string;
  sport: Sport;
  division: Division;
  date: string;
  status: V1GameStatus;
  home: { id: string | null; name: string; score: number | null };
  away: { id: string | null; name: string; score: number | null };
  scored?: { side: 'home' | 'away'; by: number };
  previousState?: GameState;
  linescore?: V1Linescore[];
  details?: ('boxscore' | 'plays')[];
}

export interface StandingsRow {
  team: string;
  conferenceRecord: string;
  overallRecord: string;
  overallPct: string;
  home: string;
  away: string;
  neutral: string;
  goalsForAgainst: string;
  streak: string;
}

export interface ConferenceStandings {
  conference: string;
  slug: string;
  logo: string;
  season: string;
  count: number;
  standings: StandingsRow[];
}

/** One row from /lax-stats leaders; numeric columns arrive as strings. */
export interface LeaderRow {
  name?: string;
  team_name: string;
  url: string;
  logo_url: string;
  team_id: string;
  player_id?: string;
  avg?: string;
  [column: string]: string | undefined;
}

export type LeaderBoards = Record<string, LeaderRow[]>;

/* /v1/team-stats — season totals summed from stored final box scores */
export interface V1TeamStatTotals {
  shots: number;
  shotsOnGoal: number;
  groundBalls: number;
  turnovers: number;
  causedTurnovers: number;
  saves: number;
  penalties: number;
  penaltyMinutes: number;
  faceoffsWon: number;
  faceoffsLost: number;
  clears: number;
  clearAttempts: number;
  extraManGoals: number;
  extraManOpportunities: number;
}

export interface V1TeamSeasonStats {
  teamId: string;
  seoName: string;
  name: string;
  shortName: string;
  /** box scores counted, not schedule length */
  games: number;
  totals: V1TeamStatTotals;
  perGame: V1TeamStatTotals;
}

/* /v1/news — collegelacrossenews.com posts via Railway */
export interface V1NewsItem {
  id: number;
  title: string;
  link: string;
  excerpt: string;
  image: string | null;
  publishedAt: string;
  author: string | null;
  category: string | null;
}

/* /v1/teams — directory, schedule/results and roster (lax.com via Railway) */
export interface V1TeamSummary {
  id: string;
  name: string;
  seoName: string | null;
  conference: string | null;
  rank: number | null;
  wins: number;
  losses: number;
}

export interface V1TeamGame {
  date: string;
  time: string | null;
  opponent: { id: string | null; name: string; seoName: string | null; rank: number | null };
  home: boolean;
  final: boolean;
  score: { us: number; them: number } | null;
  result: 'W' | 'L' | 'T' | null;
  playoff: string | null;
}

export interface V1RosterPlayer {
  id: string;
  number: string | null;
  name: string;
  position: string | null;
  year: string | null;
  hometown: string | null;
  stats: {
    goals: number;
    assists: number;
    shots: number;
    groundBalls: number;
    turnovers: number;
    causedTurnovers: number;
    faceoffsWon: number;
    faceoffsTaken: number;
    saves: number;
    shotsFaced: number;
  };
}

export interface V1TeamDetail {
  id: string;
  name: string;
  seoName: string | null;
  sport: Sport;
  division: Division;
  season: string;
  coach: string | null;
  conference: string | null;
  rank: number | null;
  overall: { wins: number; losses: number };
  conferenceRecord: { wins: number; losses: number } | null;
  website: string | null;
  seasons: string[];
  schedule: V1TeamGame[];
  roster: V1RosterPlayer[];
}
