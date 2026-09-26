/**
 * Public, stable shapes served by /v1. The website and mobile app should code
 * against these — not the raw NCAA payloads returned by the legacy routes.
 */

export type GameState = "pre" | "live" | "final" | "postponed" | "canceled";

export interface V1Team {
	/** NCAA team id, e.g. "43731"; null until gamecenter has been fetched. */
	id: string | null;
	name: string;
	shortName: string;
	seoName: string;
	char6: string;
	color: string | null;
	score: number | null;
	rank: number | null;
	seed: number | null;
	/** e.g. "16-2" */
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
	/** "1", "2", "OT", "FINAL", ... as published by NCAA */
	period: string;
	/** "12:34" while live, "" otherwise */
	clock: string;
	/** Human display string: "Final", "3rd 4:12", "1:00 PM ET" */
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
	sport: string;
	division: string;
	/** Local (ET) game date, YYYY-MM-DD */
	date: string;
	startEpoch: number | null;
	startTime: string;
	status: V1GameStatus;
	home: V1Team;
	away: V1Team;
	linescore: V1Linescore[];
	/** "pbp" when NCAA's published linescore didn't add up and it was rebuilt from goal events */
	linescoreSource: "ncaa" | "pbp";
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
	/** True once team ids / linescore / venue came from gamecenter. */
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
	/** Derived from play-by-play; null when no PBP is available. */
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

export interface V1Boxscore {
	gameId: string;
	status: { state: GameState; period: string; clock: string };
	teams: { teamId: string; isHome: boolean; name: string; shortName: string }[];
	teamStats: V1TeamLine[];
	players: V1PlayerLine[];
	/** Which fields were rebuilt from play-by-play rather than read from NCAA */
	derived: {
		faceoffs: "pbp" | "none";
		saves: "pbp" | "none";
		clears: "pbp" | "none";
	};
	updatedAt: string;
}

export type PlayType =
	| "goal"
	| "shot"
	| "save"
	| "faceoff"
	| "groundball"
	| "turnover"
	| "clear"
	| "penalty"
	| "timeout"
	| "period"
	| "lineup"
	| "other";

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
	/** goal: scorer / assist parsed from text when possible */
	scorer: string | null;
	assist: string | null;
	/** extra-man / man-down / unassisted flags parsed from text */
	tags: string[];
}

export interface V1Plays {
	gameId: string;
	status: { state: GameState; period: string; clock: string };
	teams: { teamId: string; isHome: boolean; name: string; shortName: string }[];
	plays: V1Play[];
	updatedAt: string;
}
