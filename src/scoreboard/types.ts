export interface NewScoreboardParams {
	sportCode: string;
	division: string | number;
	seasonYear: number;
	week?: number;
	contestDate?: string;
}

export interface Team {
	isHome: boolean;
	isWinner: boolean;
	score?: string | number;
	name6Char?: string;
	nameShort?: string;
	seoname?: string;
	seed?: string | number;
	teamRank?: string | number;
	conferenceSeo?: string;
}

export interface Contest {
	id?: string | number;
	contestId?: string | number;
	teams: Team[];
	startTime?: string;
	startDate?: string;
	finalMessage?: string;
	url?: string;
	broadcasterName?: string;
	liveVideos?: unknown[];
	startTimeEpoch?: string | number;
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
		broadcasterName?: string;
		round?: Record<string, unknown>;
	};
}

export interface GraphQLResponse {
	data?: {
		contests?: Contest[];
	};
}

export interface OldFormatTeam {
	names?: { short?: string; full?: string };
	description?: string;
	conferences?: { conferenceName?: string }[];
}

export interface OldFormatGame {
	game?: {
		home?: OldFormatTeam;
		away?: OldFormatTeam;
		network?: string;
	};
}

export interface OldFormatData {
	games?: OldFormatGame[];
}
