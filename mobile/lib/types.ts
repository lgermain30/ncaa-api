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
