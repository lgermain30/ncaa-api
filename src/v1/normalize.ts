import type { GamecenterContest } from "../gamecenter";
import type { Contest as ScoreboardContest } from "../scoreboard/types";
import type {
	GameState,
	PlayType,
	V1Boxscore,
	V1Game,
	V1Linescore,
	V1Play,
	V1PlayerLine,
	V1Plays,
	V1Team,
	V1TeamLine,
} from "./types";

/*
 * Pure functions that turn raw NCAA payloads into the /v1 shapes. No I/O, so
 * every branch is unit-testable with fixtures.
 */

// ---------------------------------------------------------------- helpers --

export function toInt(v: unknown): number | null {
	if (v === null || v === undefined || v === "") return null;
	const n =
		typeof v === "number"
			? v
			: Number.parseInt(String(v).replace(/,/g, ""), 10);
	return Number.isFinite(n) ? n : null;
}

function int0(v: unknown): number {
	return toInt(v) ?? 0;
}

function str(v: unknown): string {
	return v === null || v === undefined ? "" : String(v);
}

export function normalizeState(raw: unknown): GameState {
	const s = str(raw).toLowerCase();
	switch (s) {
		case "f":
		case "final":
			return "final";
		case "i":
		case "live":
		case "in_progress":
		case "in-progress":
			return "live";
		case "postponed":
		case "ppd":
			return "postponed";
		case "canceled":
		case "cancelled":
			return "canceled";
		default:
			return "pre";
	}
}

/** "(16-2)" -> "16-2" */
function cleanRecord(v: unknown): string | null {
	const s = str(v)
		.trim()
		.replace(/^\(|\)$/g, "");
	return s || null;
}

/** MM/DD/YYYY or YYYY/MM/DD -> YYYY-MM-DD */
export function toIsoDate(v: string): string | null {
	const us = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
	if (us) return `${us[3]}-${us[1]}-${us[2]}`;
	const iso = v.match(/^(\d{4})[/-](\d{2})[/-](\d{2})$/);
	if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
	return null;
}

/** Eastern-time calendar date for a unix epoch (NCAA schedules are ET). */
export function epochToEtDate(epoch: number): string {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: "America/New_York",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(new Date(epoch * 1000));
	const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
	return `${get("year")}-${get("month")}-${get("day")}`;
}

export function epochToEtTime(epoch: number): string {
	return `${new Date(epoch * 1000).toLocaleTimeString("en-US", {
		timeZone: "America/New_York",
		hour: "numeric",
		minute: "2-digit",
		hour12: true,
	})} ET`;
}

function periodLabel(period: string): string {
	const n = Number.parseInt(period, 10);
	if (!Number.isFinite(n)) return period;
	if (n <= 4) return ["1st", "2nd", "3rd", "4th"][n - 1] ?? period;
	return n === 5 ? "OT" : `${n - 4}OT`;
}

export function statusDisplay(
	state: GameState,
	period: string,
	clock: string,
	startTime: string,
	finalMessage: string,
) {
	switch (state) {
		case "final":
			return (
				finalMessage ||
				(period && period.toUpperCase() !== "FINAL"
					? `Final/${period}`
					: "Final")
			);
		case "live":
			return period.toUpperCase() === "HALF"
				? "Halftime"
				: `${periodLabel(period)} ${clock}`.trim();
		case "postponed":
			return "Postponed";
		case "canceled":
			return "Canceled";
		default:
			return startTime || "TBA";
	}
}

// ------------------------------------------------------------------- games --

interface RawTeamish {
	teamId?: string | number | null;
	isHome?: boolean;
	isWinner?: boolean;
	score?: string | number | null;
	name6Char?: string | null;
	nameShort?: string | null;
	nameFull?: string | null;
	seoname?: string | null;
	seed?: string | number | null;
	teamRank?: string | number | null;
	record?: string | null;
	color?: string | null;
	conferenceSeo?: string | null;
}

function normalizeTeam(
	t: RawTeamish | undefined,
	prev?: V1Team | null,
): V1Team {
	return {
		id:
			t?.teamId !== undefined && t?.teamId !== null
				? String(t.teamId)
				: (prev?.id ?? null),
		name: str(t?.nameFull) || prev?.name || str(t?.nameShort),
		shortName: str(t?.nameShort) || prev?.shortName || "",
		seoName: str(t?.seoname) || prev?.seoName || "",
		char6: str(t?.name6Char) || prev?.char6 || "",
		color: str(t?.color) || prev?.color || null,
		score: toInt(t?.score),
		rank: toInt(t?.teamRank) ?? prev?.rank ?? null,
		seed: toInt(t?.seed) ?? prev?.seed ?? null,
		record: cleanRecord(t?.record) ?? prev?.record ?? null,
		conference: str(t?.conferenceSeo) || prev?.conference || null,
		isWinner: Boolean(t?.isWinner),
	};
}

function normalizeLinescore(
	raw:
		| {
				period?: string | number;
				home?: string | number;
				visit?: string | number;
		  }[]
		| undefined,
): V1Linescore[] {
	return (raw ?? []).map((ls) => ({
		period: str(ls.period),
		home: toInt(ls.home),
		away: toInt(ls.visit),
	}));
}

export interface GameSources {
	sport: string;
	division: string;
	/** YYYY-MM-DD the scoreboard was requested for; used when the contest has no date */
	date?: string;
	scoreboard?: ScoreboardContest | null;
	gamecenter?: GamecenterContest | null;
	/** previously stored copy — keeps venue/team ids when only the scoreboard was refreshed */
	previous?: V1Game | null;
	now?: Date;
}

interface GamecenterTeamish extends RawTeamish {
	isHome?: boolean;
}

interface GamecenterExtras extends GamecenterContest {
	teams?: GamecenterTeamish[];
	startTimeEpoch?: string | number;
	startTime?: string;
	startDate?: string;
	finalMessage?: string;
	statusCodeDisplay?: string;
	liveVideos?: { enabled?: boolean }[];
	championshipId?: number | null;
	bracketId?: number | null;
	roundNumber?: number | null;
	roundDescription?: string | null;
	url?: string | null;
}

/** Merge the scoreboard row and (optional) gamecenter contest into one V1Game. */
export function normalizeGame(src: GameSources): V1Game {
	const sb = src.scoreboard ?? null;
	const gc = (src.gamecenter ?? null) as GamecenterExtras | null;
	const prev = src.previous ?? null;
	const now = src.now ?? new Date();

	const id = String(sb?.id ?? sb?.contestId ?? gc?.id ?? prev?.id ?? "");

	const sbTeams = (sb?.teams ?? []) as RawTeamish[];
	const gcTeams = gc?.teams ?? [];
	const pick = (home: boolean) => {
		const g = gcTeams.find((t) => t.isHome === home);
		const s = sbTeams.find((t) => t.isHome === home);
		// gamecenter has ids/records/colors; scoreboard has the freshest score
		const merged: RawTeamish | undefined =
			g || s ? { ...(g ?? {}), ...(s ?? {}) } : undefined;
		if (merged && g) {
			merged.teamId = g.teamId;
			merged.nameFull = g.nameFull;
			merged.record = g.record;
			merged.color = g.color;
			if (
				merged.score === undefined ||
				merged.score === null ||
				merged.score === ""
			)
				merged.score = g.score;
		}
		return merged;
	};

	const startEpoch =
		toInt(sb?.startTimeEpoch ?? gc?.startTimeEpoch) ?? prev?.startEpoch ?? null;
	const date =
		(sb?.startDate ? toIsoDate(sb.startDate) : null) ??
		(gc?.startDate ? toIsoDate(gc.startDate) : null) ??
		(startEpoch ? epochToEtDate(startEpoch) : null) ??
		src.date ??
		prev?.date ??
		"";

	const rawState = sb?.gameState ?? gc?.gameState ?? prev?.status.state;
	let state = normalizeState(rawState);
	const display = str(
		sb?.statusCodeDisplay ?? gc?.statusCodeDisplay,
	).toLowerCase();
	if (display.includes("postpone")) state = "postponed";
	else if (display.includes("cancel")) state = "canceled";

	const period = str(sb?.currentPeriod ?? gc?.currentPeriod);
	const clock = state === "live" ? str(sb?.contestClock || gc?.clock) : "";
	const startTime =
		startEpoch && (sb?.hasStartTime ?? gc?.hasStartTime ?? true) !== false
			? epochToEtTime(startEpoch)
			: str(sb?.startTime) === "TBA" || !str(sb?.startTime)
				? "TBA"
				: str(sb?.startTime);
	const finalMessage = str(sb?.finalMessage ?? gc?.finalMessage);

	const linescore = normalizeLinescore(gc?.linescores ?? sb?.linescores);

	const venue =
		gc?.location?.venue || gc?.location?.city
			? {
					name: str(gc?.location?.venue),
					city: str(gc?.location?.city),
					state: str(gc?.location?.stateUsps),
				}
			: (prev?.venue ?? null);

	const network =
		str(gc?.network) ||
		str(sb?.championshipGame?.broadcasterName) ||
		str(sb?.broadcasterName) ||
		prev?.broadcast.network ||
		null;

	const liveVideo =
		(gc?.liveVideos ?? []).some((v) => v?.enabled) ||
		((sb?.liveVideos ?? []).length > 0 && state === "live");

	const attendance = toInt(gc?.attendance) ?? prev?.attendance ?? null;

	const championshipId =
		sb?.championshipId ??
		gc?.championshipId ??
		prev?.bracket?.championshipId ??
		null;
	const bracket =
		championshipId || sb?.bracketId || gc?.bracketId
			? {
					championshipId: championshipId ?? null,
					bracketId:
						sb?.bracketId ?? gc?.bracketId ?? prev?.bracket?.bracketId ?? null,
					round:
						sb?.roundNumber ?? gc?.roundNumber ?? prev?.bracket?.round ?? null,
					roundDescription:
						sb?.roundDescription ||
						gc?.roundDescription ||
						prev?.bracket?.roundDescription ||
						null,
				}
			: null;

	const url = sb?.url ?? gc?.url ?? null;
	const home = normalizeTeam(pick(true), prev?.home);
	const away = normalizeTeam(pick(false), prev?.away);

	return {
		id,
		sport: src.sport,
		division: src.division,
		date,
		startEpoch,
		startTime,
		status: {
			state,
			period,
			clock,
			display: statusDisplay(state, period, clock, startTime, finalMessage),
			finalMessage,
		},
		home,
		away,
		...pickLinescore(linescore, home, away, prev),
		venue,
		broadcast: { network, liveVideo },
		attendance,
		bracket,
		links: {
			ncaa: url ? `https://www.ncaa.com${url}` : (prev?.links.ncaa ?? null),
		},
		detailed: Boolean(gc) || Boolean(prev?.detailed),
		updatedAt: now.toISOString(),
	};
}

// ---------------------------------------------------------------- boxscore --

interface RawGoalie {
	saves?: string | number;
	goalsAllowed?: string | number;
	minutesPlayed?: string | number;
}

interface RawPlayerStats {
	firstName?: string;
	lastName?: string;
	position?: string;
	number?: string | number;
	starter?: boolean;
	participated?: boolean;
	goals?: string | number;
	assists?: string | number;
	shots?: string | number;
	shotsOnGoal?: string | number;
	groundBalls?: string | number;
	turnovers?: string | number;
	causedTurnovers?: string | number;
	drawControls?: string | number;
	goalie?: RawGoalie | null;
	penalties?: { count?: string | number; minutes?: string | number } | null;
}

interface RawTeamStats {
	goals?: string | number;
	assists?: string | number;
	shots?: string | number;
	shotsOnGoal?: string | number;
	groundBalls?: string | number;
	turnovers?: string | number;
	causedTurnovers?: string | number;
	drawControls?: string | number;
	faceoffsWon?: string | number;
	faceoffsLost?: string | number;
	clears?: string | number;
	clearAttempts?: string | number;
	goalie?: RawGoalie | null;
	penalties?: { count?: string | number; minutes?: string | number } | null;
	powerPlay?: {
		goals?: string | number;
		opportunities?: string | number;
	} | null;
}

export interface RawBoxscore {
	contestId?: string | number;
	status?: string;
	period?: string | number | null;
	minutes?: string | number | null;
	seconds?: string | number | null;
	teams?: {
		teamId?: string | number;
		isHome?: boolean;
		nameFull?: string;
		nameShort?: string;
	}[];
	teamBoxscore?: {
		teamId?: string | number;
		playerStats?: RawPlayerStats[];
		teamStats?: RawTeamStats;
	}[];
}

export interface RawPlayByPlay {
	contestId?: string | number;
	status?: string;
	period?: string | number | null;
	minutes?: string | number | null;
	seconds?: string | number | null;
	teams?: {
		teamId?: string | number;
		isHome?: boolean;
		nameFull?: string;
		nameShort?: string;
	}[];
	periods?: {
		periodNumber?: number;
		periodDisplay?: string;
		playbyplayStats?: {
			clock?: string;
			teamId?: string | number;
			plays?: {
				playText?: string;
				homeScore?: string | number | null;
				visitorScore?: string | number | null;
				clock?: string;
			}[];
		}[];
	}[];
}

/** "Perea, Noah" / "NOAH PEREA" / "Noah Perea" -> "noah perea" */
export function nameKey(name: string): string {
	const cleaned = name
		.replace(/\./g, "")
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase();
	const comma = cleaned.indexOf(",");
	const tokens =
		comma >= 0
			? [
					...cleaned
						.slice(comma + 1)
						.trim()
						.split(" "),
					...cleaned.slice(0, comma).trim().split(" "),
				]
			: cleaned.split(" ");
	return tokens.filter(Boolean).sort().join(" ");
}

function clockFromParts(minutes: unknown, seconds: unknown): string {
	const m = toInt(minutes);
	const s = toInt(seconds);
	if (m === null && s === null) return "";
	return `${m ?? 0}:${String(s ?? 0).padStart(2, "0")}`;
}

function detailStatus(raw: {
	status?: string;
	period?: string | number | null;
	minutes?: unknown;
	seconds?: unknown;
}) {
	const state = normalizeState(raw.status);
	return {
		state,
		period: str(raw.period),
		clock: state === "live" ? clockFromParts(raw.minutes, raw.seconds) : "",
	};
}

function detailTeams(raw: { teams?: RawBoxscore["teams"] }) {
	return (raw.teams ?? []).map((t) => ({
		teamId: str(t.teamId),
		isHome: Boolean(t.isHome),
		name: str(t.nameFull) || str(t.nameShort),
		shortName: str(t.nameShort),
	}));
}

interface PbpSplits {
	faceoffsWon: Map<string, number>;
	faceoffsTaken: Map<string, number>;
	saves: Map<string, number>;
	goalsAllowed: Map<string, number>;
	/** teamId -> nameKey of goalie currently in net */
	goaliesByTeam: Map<string, string>;
	/** teamId -> { good, attempts } from "Clear attempt by TEAM good/failed." */
	clears: Map<string, { good: number; attempts: number }>;
	hasFaceoffs: boolean;
	hasSaves: boolean;
}

const GOALIE_RE = /^(.+?) at goalie for /i;
const FACEOFF_RE = /^Faceoff (.+?) vs (.+?) won by /i;
const SAVE_RE = /,\s*SAVE (.+?)\s*$/i;
const CLEAR_RE = /^Clear attempt by .+? (good|failed)\b/i;
const GOAL_RE =
	/^GOAL by (\S+) (.+?)(?: \((.*?)\))?(?:, Assist by (.+?))?(?:, goal number .*)?\.?$/i;

/**
 * Per-player faceoff and goalie splits that NCAA does not publish in the box
 * score, derived from the play text. Roster keys per team let us attribute the
 * faceoff winner to the correct man and fall back to "goalie in net" when a
 * save's goalie name doesn't match a roster entry.
 */
export function splitsFromPlays(
	pbp: RawPlayByPlay | null,
	rosters: Map<string, Set<string>>,
): PbpSplits {
	const out: PbpSplits = {
		faceoffsWon: new Map(),
		faceoffsTaken: new Map(),
		saves: new Map(),
		goalsAllowed: new Map(),
		goaliesByTeam: new Map(),
		clears: new Map(),
		hasFaceoffs: false,
		hasSaves: false,
	};
	if (!pbp) return out;
	pbp = dedupePlayByPlay(pbp) ?? pbp;
	const bump = (m: Map<string, number>, k: string) =>
		m.set(k, (m.get(k) ?? 0) + 1);
	const teamIds = (pbp.teams ?? []).map((t) => str(t.teamId));
	const otherTeam = (teamId: string) => teamIds.find((t) => t !== teamId) ?? "";
	const onTeam = (teamId: string, key: string) =>
		rosters.get(teamId)?.has(key) ?? false;

	for (const period of pbp.periods ?? []) {
		for (const stat of period.playbyplayStats ?? []) {
			const teamId = str(stat.teamId);
			for (const play of stat.plays ?? []) {
				const text = str(play.playText).trim();
				if (!text) continue;

				const goalie = text.match(GOALIE_RE);
				if (goalie) {
					out.goaliesByTeam.set(teamId, nameKey(goalie[1]));
					continue;
				}

				const clear = text.match(CLEAR_RE);
				if (clear) {
					const c = out.clears.get(teamId) ?? { good: 0, attempts: 0 };
					c.attempts++;
					if (clear[1].toLowerCase() === "good") c.good++;
					out.clears.set(teamId, c);
					continue;
				}

				const fo = text.match(FACEOFF_RE);
				if (fo) {
					out.hasFaceoffs = true;
					const a = nameKey(fo[1]);
					const b = nameKey(fo[2]);
					bump(out.faceoffsTaken, a);
					bump(out.faceoffsTaken, b);
					// play is attributed to the winning team; credit whichever man is on it
					const winner = onTeam(teamId, a) ? a : onTeam(teamId, b) ? b : null;
					if (winner) bump(out.faceoffsWon, winner);
					continue;
				}

				const save = text.match(SAVE_RE);
				if (save && /^Shot by /i.test(text)) {
					out.hasSaves = true;
					const key = nameKey(save[1]);
					const defending = otherTeam(teamId);
					const credited = onTeam(defending, key)
						? key
						: (out.goaliesByTeam.get(defending) ?? key);
					bump(out.saves, credited);
					continue;
				}

				if (/^GOAL by /i.test(text)) {
					const defending = otherTeam(teamId);
					const g = out.goaliesByTeam.get(defending);
					if (g) bump(out.goalsAllowed, g);
				}
			}
		}
	}
	return out;
}

function penalties(
	p: { count?: unknown; minutes?: unknown } | null | undefined,
) {
	if (!p) return null;
	const count = toInt(p.count);
	const minutes = toInt(p.minutes);
	if (count === null && minutes === null) return null;
	return { count: count ?? 0, minutes: minutes ?? 0 };
}

/**
 * Combine the two NCAA boxscore queries (player lines + team totals) and the
 * play-by-play into one V1Boxscore with per-player faceoff/save splits.
 */
export function normalizeBoxscore(
	gameId: string,
	box: RawBoxscore | null,
	teamStatsBox: RawBoxscore | null,
	pbp: RawPlayByPlay | null,
	now: Date = new Date(),
): V1Boxscore {
	const base = box ?? teamStatsBox ?? {};
	const teams = detailTeams(base);

	const rosters = new Map<string, Set<string>>();
	const rawPlayers: { teamId: string; p: RawPlayerStats }[] = [];
	for (const tb of box?.teamBoxscore ?? []) {
		const teamId = str(tb.teamId);
		const set = new Set<string>();
		for (const p of tb.playerStats ?? []) {
			set.add(nameKey(`${str(p.firstName)} ${str(p.lastName)}`));
			rawPlayers.push({ teamId, p });
		}
		rosters.set(teamId, set);
	}

	const splits = splitsFromPlays(pbp, rosters);

	const players: V1PlayerLine[] = rawPlayers.map(({ teamId, p }) => {
		const key = nameKey(`${str(p.firstName)} ${str(p.lastName)}`);
		const goalieRaw = p.goalie ?? null;
		const inNet = splits.goaliesByTeam.get(teamId) === key;
		const savesRaw = toInt(goalieRaw?.saves);
		const saves =
			savesRaw ??
			(splits.hasSaves ? (splits.saves.get(key) ?? (inNet ? 0 : null)) : null);
		const goalsAllowed =
			toInt(goalieRaw?.goalsAllowed) ??
			(splits.hasSaves && (saves !== null || inNet)
				? (splits.goalsAllowed.get(key) ?? 0)
				: null);
		const isGoalie =
			Boolean(
				goalieRaw &&
					(savesRaw ?? 0) + (toInt(goalieRaw?.minutesPlayed) ?? 0) > 0,
			) ||
			str(p.position).toUpperCase() === "G" ||
			str(p.position).toUpperCase() === "GK" ||
			(saves !== null && saves > 0) ||
			inNet;
		const taken = splits.hasFaceoffs
			? (splits.faceoffsTaken.get(key) ?? 0)
			: null;
		const goals = int0(p.goals);
		const assists = int0(p.assists);
		return {
			teamId,
			name: `${str(p.firstName)} ${str(p.lastName)}`.trim(),
			firstName: str(p.firstName),
			lastName: str(p.lastName),
			number: toInt(p.number),
			position: str(p.position),
			starter: Boolean(p.starter),
			played: p.participated !== false,
			goals,
			assists,
			points: goals + assists,
			shots: int0(p.shots),
			shotsOnGoal: int0(p.shotsOnGoal),
			groundBalls: int0(p.groundBalls),
			turnovers: int0(p.turnovers),
			causedTurnovers: int0(p.causedTurnovers),
			drawControls: int0(p.drawControls),
			faceoffsWon: taken === null ? null : (splits.faceoffsWon.get(key) ?? 0),
			faceoffsTaken: taken,
			saves: isGoalie ? (saves ?? 0) : saves,
			goalsAllowed: isGoalie ? (goalsAllowed ?? 0) : goalsAllowed,
			isGoalie,
			penalties: penalties(p.penalties),
		};
	});

	// Team totals: prefer the dedicated team-stats query (has faceoffs/clears),
	// fill from the player-boxscore team totals, then from summed player lines.
	let clearsDerived = false;
	const teamStats: V1TeamLine[] = teams.map((t) => {
		const ts =
			teamStatsBox?.teamBoxscore?.find((tb) => str(tb.teamId) === t.teamId)
				?.teamStats ?? {};
		const bs =
			box?.teamBoxscore?.find((tb) => str(tb.teamId) === t.teamId)?.teamStats ??
			{};
		const mine = players.filter((p) => p.teamId === t.teamId);
		const sum = (f: (p: V1PlayerLine) => number | null) =>
			mine.reduce((a, p) => a + (f(p) ?? 0), 0);
		const pick = (k: keyof RawTeamStats) =>
			toInt(ts[k] as unknown) ?? toInt(bs[k] as unknown);
		const pbpFoWon = splits.hasFaceoffs ? sum((p) => p.faceoffsWon) : null;
		const pbpFoTaken = splits.hasFaceoffs ? sum((p) => p.faceoffsTaken) : null;
		const saves =
			toInt(ts.goalie?.saves) ??
			toInt(bs.goalie?.saves) ??
			(splits.hasSaves ? sum((p) => p.saves) : null);
		const goalsAllowed =
			toInt(ts.goalie?.goalsAllowed) ?? toInt(bs.goalie?.goalsAllowed) ?? null;
		const pp = ts.powerPlay ?? bs.powerPlay ?? null;
		const ncaaClears = pick("clears");
		const ncaaClearAttempts = pick("clearAttempts");
		const pbpClears = splits.clears.get(t.teamId);
		// NCAA lacrosse feeds often report clears=0 alongside a real attempt count;
		// use the PBP tally when it exists and the published number is absent/zero.
		const useClearsFromPbp =
			pbpClears !== undefined && (ncaaClears === null || ncaaClears === 0);
		if (useClearsFromPbp) clearsDerived = true;
		return {
			teamId: t.teamId,
			goals: pick("goals") ?? sum((p) => p.goals),
			assists: pick("assists") ?? sum((p) => p.assists),
			shots: pick("shots") ?? sum((p) => p.shots),
			shotsOnGoal: pick("shotsOnGoal") ?? sum((p) => p.shotsOnGoal),
			groundBalls: pick("groundBalls") ?? sum((p) => p.groundBalls),
			turnovers: pick("turnovers") ?? sum((p) => p.turnovers),
			causedTurnovers: pick("causedTurnovers") ?? sum((p) => p.causedTurnovers),
			drawControls: pick("drawControls"),
			faceoffsWon: pick("faceoffsWon") ?? pbpFoWon,
			faceoffsLost:
				pick("faceoffsLost") ??
				(pbpFoTaken !== null && pbpFoWon !== null
					? pbpFoTaken - pbpFoWon
					: null),
			clears: useClearsFromPbp ? pbpClears.good : ncaaClears,
			clearAttempts: useClearsFromPbp
				? ncaaClearAttempts || pbpClears.attempts
				: ncaaClearAttempts,
			saves,
			goalsAllowed,
			penalties: penalties(ts.penalties ?? bs.penalties),
			extraMan: pp
				? { goals: int0(pp.goals), opportunities: int0(pp.opportunities) }
				: null,
		};
	});

	// A lone goalie owns the team's save line when NCAA left the player row at 0.
	for (const t of teamStats) {
		const keepers = players.filter((p) => p.isGoalie && p.teamId === t.teamId);
		if (keepers.length !== 1 || !t.saves) continue;
		const gk = keepers[0];
		if (gk.saves) continue;
		gk.saves = t.saves;
		gk.goalsAllowed =
			t.goalsAllowed ??
			teamStats.find((o) => o.teamId !== t.teamId)?.goals ??
			gk.goalsAllowed;
	}

	const anyPublished = (
		f: (x: { groundBalls: number; turnovers: number }) => number,
	) => players.some((p) => f(p) > 0) || teamStats.some((t) => f(t) > 0);

	return {
		gameId,
		status: detailStatus(base),
		teams,
		teamStats,
		players,
		derived: {
			faceoffs: splits.hasFaceoffs ? "pbp" : "none",
			saves: splits.hasSaves ? "pbp" : "none",
			clears: clearsDerived ? "pbp" : "none",
			groundBalls: anyPublished((x) => x.groundBalls) ? "box" : "none",
			turnovers: anyPublished((x) => x.turnovers) ? "box" : "none",
		},
		updatedAt: now.toISOString(),
	};
}

/**
 * Period scoring rebuilt from goal events. NCAA sometimes publishes an
 * all-zero linescore for games whose play-by-play has every goal; this fills
 * the gap and is only used when the published linescore doesn't add up.
 */
/**
 * Keep a play-by-play-derived linescore over a fresh NCAA one that still
 * doesn't add up to the score (NCAA's zeros never "correct" real data).
 */
function pickLinescore(
	fresh: V1Linescore[],
	home: V1Team,
	away: V1Team,
	prev: V1Game | null,
): Pick<V1Game, "linescore" | "linescoreSource"> {
	if (
		prev?.linescoreSource === "pbp" &&
		!linescoreAddsUp({ linescore: fresh, home, away })
	) {
		return { linescore: prev.linescore, linescoreSource: "pbp" };
	}
	if (fresh.length) return { linescore: fresh, linescoreSource: "ncaa" };
	return {
		linescore: prev?.linescore ?? [],
		linescoreSource: prev?.linescoreSource ?? "ncaa",
	};
}

export function linescoreFromPlays(plays: V1Play[]): V1Linescore[] {
	const goals = plays.filter(
		(p) => p.type === "goal" && p.homeScore !== null && p.awayScore !== null,
	);
	if (!goals.length) return [];
	const maxPeriod = Math.max(...plays.map((p) => p.period), 4);
	const out: V1Linescore[] = [];
	let prevHome = 0;
	let prevAway = 0;
	for (let period = 1; period <= maxPeriod; period++) {
		const inPeriod = goals.filter((g) => g.period === period);
		const last = inPeriod[inPeriod.length - 1];
		const home = last ? (last.homeScore as number) : prevHome;
		const away = last ? (last.awayScore as number) : prevAway;
		out.push({
			period: String(period),
			home: home - prevHome,
			away: away - prevAway,
		});
		prevHome = home;
		prevAway = away;
	}
	return out;
}

export function linescoreAddsUp(
	game: Pick<V1Game, "linescore" | "home" | "away">,
): boolean {
	if (!game.linescore.length) return false;
	const home = game.linescore.reduce((a, l) => a + (l.home ?? 0), 0);
	const away = game.linescore.reduce((a, l) => a + (l.away ?? 0), 0);
	return home === (game.home.score ?? 0) && away === (game.away.score ?? 0);
}

// ------------------------------------------------------------------- plays --

/**
 * Older NCAA feeds repeat every play 2-4 times back to back; keep the first of
 * each run of identical consecutive rows.
 */
export function dedupePlayByPlay(
	pbp: RawPlayByPlay | null,
): RawPlayByPlay | null {
	if (!pbp?.periods) return pbp;
	let prev = "";
	return {
		...pbp,
		periods: pbp.periods.map((period) => ({
			...period,
			playbyplayStats: (period.playbyplayStats ?? []).map((stat) => ({
				...stat,
				plays: (stat.plays ?? []).filter((play) => {
					const key = `${period.periodNumber}|${stat.teamId}|${str(play.clock || stat.clock)}|${play.homeScore}|${play.visitorScore}|${str(play.playText).trim()}`;
					if (key === prev) return false;
					prev = key;
					return true;
				}),
			})),
		})),
	};
}

export function classifyPlay(text: string): PlayType {
	const t = text.trim();
	if (!t) return "other";
	if (/^GOAL by /i.test(t)) return "goal";
	if (/^Shot by .*,\s*SAVE /i.test(t)) return "save";
	if (/^Shot by /i.test(t)) return "shot";
	if (/^Faceoff /i.test(t) || /^Draw control/i.test(t)) return "faceoff";
	if (/^Ground ball/i.test(t)) return "groundball";
	if (/^Turnover/i.test(t)) return "turnover";
	if (/^Clear attempt/i.test(t)) return "clear";
	if (/^Penalty|^Yellow card|^Green card|^Red card|clock violation/i.test(t))
		return "penalty";
	if (/^Timeout|^Media timeout/i.test(t)) return "timeout";
	if (/^End-of-period|^End of period|^Start of period|^Start of \d/i.test(t))
		return "period";
	if (/ at goalie for /i.test(t)) return "lineup";
	return "other";
}

export function parseGoal(text: string): {
	scorer: string | null;
	assist: string | null;
	tags: string[];
} {
	const m = text.match(GOAL_RE);
	if (!m) return { scorer: null, assist: null, tags: [] };
	const tags: string[] = [];
	const paren = (m[3] ?? "").toUpperCase();
	if (paren.includes("FIRST GOAL")) tags.push("first-goal");
	if (
		paren.includes("MAN-UP") ||
		paren.includes("EXTRA-MAN") ||
		paren.includes("EMO")
	)
		tags.push("extra-man");
	if (paren.includes("MAN-DOWN") || paren.includes("SHORT"))
		tags.push("man-down");
	if (paren.includes("FREE POSITION")) tags.push("free-position");
	if (paren.includes("EMPTY")) tags.push("empty-net");
	const assist = m[4]?.trim() || null;
	if (!assist) tags.push("unassisted");
	return { scorer: m[2].trim(), assist, tags };
}

export function normalizePlays(
	gameId: string,
	pbp: RawPlayByPlay | null,
	now: Date = new Date(),
): V1Plays {
	const plays: V1Play[] = [];
	let n = 0;
	for (const period of dedupePlayByPlay(pbp)?.periods ?? []) {
		const periodNumber = period.periodNumber ?? 0;
		for (const stat of period.playbyplayStats ?? []) {
			for (const play of stat.plays ?? []) {
				const text = str(play.playText).trim();
				if (!text) continue;
				n++;
				const type = classifyPlay(text);
				const goal =
					type === "goal"
						? parseGoal(text)
						: { scorer: null, assist: null, tags: [] as string[] };
				plays.push({
					id: `${gameId}-${periodNumber}-${n}`,
					period: periodNumber,
					periodDisplay:
						str(period.periodDisplay) || periodLabel(String(periodNumber)),
					clock: str(play.clock || stat.clock),
					teamId:
						stat.teamId !== undefined && stat.teamId !== null
							? String(stat.teamId)
							: null,
					type,
					text,
					homeScore: toInt(play.homeScore),
					awayScore: toInt(play.visitorScore),
					scorer: goal.scorer,
					assist: goal.assist,
					tags: goal.tags,
				});
			}
		}
	}
	return {
		gameId,
		status: detailStatus(pbp ?? {}),
		teams: detailTeams(pbp ?? {}),
		plays,
		updatedAt: now.toISOString(),
	};
}
