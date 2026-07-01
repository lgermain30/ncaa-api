export interface Contest {
  contestId?: string;
  teams: Team[];
  startTime?: string;
  startDate?: string;
  finalMessage?: string;
  url?: string;
  broadcasterName?: string;
  liveVideos?: unknown[];
  startTimeEpoch?: string;
  gameState?: string;
  currentPeriod?: string;
  contestClock?: string;

  // Quarter / period scoring
  linescores?: {
    period: string;
    home: string;
    visit: string;
  }[];

  bracketId?: number;
  roundNumber?: number;
  roundDescription?: string;
  championshipId?: number;
  championshipGame?: {
    __typename?: string;
    round?: Record<string, unknown>;
  };
}
