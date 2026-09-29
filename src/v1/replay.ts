import { getDetail, listGames } from "../store";
import { publishDetails, publishGame } from "./events";
import {
	epochToEtDate,
	epochToEtTime,
	linescoreFromPlays,
	nameKey,
	statusDisplay,
} from "./normalize";
import type {
	V1Boxscore,
	V1Game,
	V1Play,
	V1PlayerLine,
	V1Plays,
	V1TeamLine,
} from "./types";

/*
 * Admin-only replay: re-plays a stored past game day as if it were happening
 * right now. Each game gets a virtual tip time; its stored play-by-play is
 * released against a running game clock (15:00 quarters, breaks, halftime,
 * 4:00 overtimes), and the score, linescore, status and box score are rebuilt
 * from the plays released so far. When the virtual clock passes the last play
 * the game snaps to the real stored final.
 *
 * Nothing here is written to the store or fetched from NCAA; the service layer
 * consults `replayBoard` / `replayGame` / ... only while a replay is active, so
 * visitors see exactly the normal data when it is off.
 */

export const QUARTER_MS = 15 * 60_000;
export const OT_MS = 4 * 60_000;
const BREAK_MS = 2 * 60_000;
const HALFTIME_MS = 10 * 60_000;

export interface ReplayOptions {
	/** Stored game day to replay, YYYY-MM-DD */
	date: string;
	sports?: string[];
	divisions?: string[];
	/** Restrict to these game ids */
	games?: string[];
	/** Virtual seconds per real second (1 = real time) */
	speed?: number;
	/** Seconds before the first game tips off */
	leadSec?: number;
	/** Seconds between consecutive tip-offs */
	staggerSec?: number;
	/** Cap on the number of games replayed */
	limit?: number;
}

interface ReplayGame {
	final: V1Game;
	plays: V1Plays;
	boxscore: V1Boxscore | null;
	/** virtual ms after replay start when this game tips off */
	tipMs: number;
	/** virtual ms after tip when the game is final */
	endMs: number;
	elapsed: number[];
	lastServed: V1Game | null;
	lastPlayCount: number;
}

interface ReplayRun {
	options: Required<ReplayOptions>;
	startedAt: number;
	games: ReplayGame[];
}

let run: ReplayRun | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
const TICK_MS = Number(process.env.REPLAY_TICK_MS) || 2_000;

export interface ReplayStatus {
	active: boolean;
	date: string | null;
	startedAt: string | null;
	speed: number;
	games: {
		id: string;
		sport: string;
		division: string;
		matchup: string;
		state: string;
		display: string;
		score: string;
		playsReleased: number;
		playsTotal: number;
	}[];
}

export function replayStatus(now = Date.now()): ReplayStatus {
	if (!run) {
		return { active: false, date: null, startedAt: null, speed: 1, games: [] };
	}
	const v = virtualMs(now);
	return {
		active: true,
		date: run.options.date,
		startedAt: new Date(run.startedAt).toISOString(),
		speed: run.options.speed,
		games: run.games.map((g) => {
			const game = gameAt(g, v, now);
			const released = playsAt(g, v).length;
			return {
				id: g.final.id,
				sport: g.final.sport,
				division: g.final.division,
				matchup: `${g.final.away.shortName} at ${g.final.home.shortName}`,
				state: game.status.state,
				display: game.status.display,
				score: `${game.away.score ?? 0}-${game.home.score ?? 0}`,
				playsReleased: released,
				playsTotal: g.plays.plays.length,
			};
		}),
	};
}

export function replayActive(): boolean {
	return run !== null;
}

function virtualMs(now: number): number {
	if (!run) return 0;
	return (now - run.startedAt) * run.options.speed;
}

function clockMs(clock: string): number | null {
	const m = clock.match(/^(\d{1,2}):(\d{2})$/);
	if (!m) return null;
	return (Number(m[1]) * 60 + Number(m[2])) * 1000;
}

function periodLength(period: number): number {
	return period <= 4 ? QUARTER_MS : OT_MS;
}

/** Virtual ms after tip at which `period` starts (1-based; 5+ are overtimes). */
export function periodStartMs(period: number): number {
	let t = 0;
	for (let p = 1; p < period; p++) {
		t += periodLength(p);
		t += p === 2 ? HALFTIME_MS : BREAK_MS;
	}
	return t;
}

/** Virtual ms after tip when a play happens. Plays without a clock go to period start. */
export function playElapsedMs(play: Pick<V1Play, "period" | "clock">): number {
	const period = Math.max(1, play.period);
	const len = periodLength(period);
	const c = clockMs(play.clock);
	const remaining = c === null ? len : Math.min(len, Math.max(0, c));
	return periodStartMs(period) + (len - remaining);
}

function playsAt(g: ReplayGame, v: number): V1Play[] {
	const t = v - g.tipMs;
	if (t < 0) return [];
	if (t >= g.endMs) return g.plays.plays;
	const out: V1Play[] = [];
	for (let i = 0; i < g.plays.plays.length; i++) {
		if (g.elapsed[i] <= t) out.push(g.plays.plays[i]);
	}
	return out;
}

function liveStatus(t: number, maxPeriod: number) {
	for (let p = 1; p <= Math.max(4, maxPeriod); p++) {
		const start = periodStartMs(p);
		const len = periodLength(p);
		if (t < start) {
			// in the break before period p
			const prev = p - 1;
			return prev === 2
				? { period: "HALF", clock: "" }
				: { period: String(prev), clock: "0:00" };
		}
		if (t < start + len) {
			const remaining = start + len - t;
			const s = Math.ceil(remaining / 1000);
			return {
				period: String(p),
				clock: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`,
			};
		}
	}
	return { period: String(maxPeriod), clock: "0:00" };
}

function shiftedBase(g: ReplayGame): V1Game {
	if (!run) return g.final;
	const tipEpoch = Math.floor(
		(run.startedAt + g.tipMs / run.options.speed) / 1000,
	);
	return {
		...g.final,
		date: epochToEtDate(tipEpoch),
		startEpoch: tipEpoch,
		startTime: epochToEtTime(tipEpoch),
	};
}

function gameAt(g: ReplayGame, v: number, now: number): V1Game {
	const base = shiftedBase(g);
	const t = v - g.tipMs;
	const updatedAt = new Date(now).toISOString();
	if (t < 0) {
		return {
			...base,
			status: {
				state: "pre",
				period: "",
				clock: "",
				display: base.startTime,
				finalMessage: "",
			},
			home: { ...base.home, score: null, isWinner: false },
			away: { ...base.away, score: null, isWinner: false },
			linescore: [],
			attendance: null,
			updatedAt,
		};
	}
	if (t >= g.endMs) return { ...base, updatedAt };

	const released = playsAt(g, v);
	const maxPeriod = Math.max(4, ...g.plays.plays.map((p) => p.period));
	const { period, clock } = liveStatus(t, maxPeriod);
	let home = 0;
	let away = 0;
	for (const p of released) {
		if (p.type === "goal" && p.homeScore !== null && p.awayScore !== null) {
			home = p.homeScore;
			away = p.awayScore;
		}
	}
	const reached = period === "HALF" ? 2 : Number(period);
	const linescore = linescoreFromPlays(released).filter(
		(ls) => Number(ls.period) <= reached,
	);
	return {
		...base,
		status: {
			state: "live",
			period,
			clock,
			display: statusDisplay("live", period, clock, base.startTime, ""),
			finalMessage: "",
		},
		home: { ...base.home, score: home, isWinner: false },
		away: { ...base.away, score: away, isWinner: false },
		linescore,
		linescoreSource: "pbp",
		attendance: null,
		updatedAt,
	};
}

function playsPayload(g: ReplayGame, v: number, now: number): V1Plays {
	const game = gameAt(g, v, now);
	return {
		...g.plays,
		status: {
			state: game.status.state,
			period: game.status.period,
			clock: game.status.clock,
		},
		plays: playsAt(g, v),
		updatedAt: game.updatedAt,
	};
}

const GOAL_RE =
	/^GOAL by \S+ (.+?)(?: \(.*?\))?(?:, Assist by (.+?))?(?:, goal number .*)?\.?$/i;
const SAVE_RE = /^Shot by \S+ (.+?),\s*SAVE by (.+?)\s*$/i;
const SHOT_RE =
	/^Shot by \S+ (.+?)(?: (?:WIDE|HIGH|HIT POST|BLOCKED|HIT CROSSBAR).*)?$/i;
const FACEOFF_RE = /^Faceoff (.+?) vs (.+?) won by (\S+)/i;
const GB_RE = /Ground ball pickup by \S+ ([^.]+)/gi;
const TURNOVER_RE = /^Turnover by \S+ ([^(]+?)(?:\s*\(caused by (.+?)\))?\.?$/i;
const PENALTY_RE = /^Penalty on \S+ (.+?) \(.*?\/(\d+):(\d{2})\)/i;
const GOALIE_RE = /^(.+?) at goalie for (\S+)/i;
const DRAW_RE = /^Draw control (?:won )?by \S+ (.+?)\.?$/i;

/**
 * Rebuild a partial box score from the plays released so far, keyed to the
 * roster of the stored final box (so names, numbers and positions match).
 */
export function boxscoreFromPlays(
	final: V1Boxscore,
	plays: V1Play[],
	status: V1Boxscore["status"],
	updatedAt: string,
): V1Boxscore {
	const players: V1PlayerLine[] = final.players.map((p) => ({
		...p,
		played: false,
		goals: 0,
		assists: 0,
		points: 0,
		shots: 0,
		shotsOnGoal: 0,
		groundBalls: 0,
		turnovers: 0,
		causedTurnovers: 0,
		drawControls: 0,
		faceoffsWon: p.faceoffsWon === null ? null : 0,
		faceoffsTaken: p.faceoffsTaken === null ? null : 0,
		saves: p.isGoalie ? 0 : p.saves === null ? null : 0,
		goalsAllowed: p.isGoalie ? 0 : p.goalsAllowed === null ? null : 0,
		penalties: p.penalties ? { count: 0, minutes: 0 } : null,
	}));
	const byKey = new Map<string, V1PlayerLine>();
	for (const p of players) byKey.set(`${p.teamId}|${nameKey(p.name)}`, p);
	const teamIds = final.teams.map((t) => t.teamId);
	const other = (teamId: string) => teamIds.find((t) => t !== teamId) ?? "";
	const find = (teamId: string | null, name: string) => {
		const key = nameKey(name);
		if (teamId) {
			const hit = byKey.get(`${teamId}|${key}`);
			if (hit) return hit;
		}
		for (const t of teamIds) {
			const hit = byKey.get(`${t}|${key}`);
			if (hit) return hit;
		}
		return null;
	};
	const isGoalie = (p: V1PlayerLine) =>
		p.isGoalie || /^(g|gk|goal)/i.test(p.position);
	const goalieFor = new Map<string, V1PlayerLine>();
	for (const t of teamIds) {
		const g = players.filter((p) => p.teamId === t && isGoalie(p));
		if (g.length === 1) goalieFor.set(t, g[0]);
	}
	const clears = new Map<string, { good: number; attempts: number }>();
	const touch = (p: V1PlayerLine | null) => {
		if (p) p.played = true;
		return p;
	};

	for (const play of plays) {
		const text = play.text.trim();
		const team = play.teamId;
		const goalie = text.match(GOALIE_RE);
		if (goalie) {
			const g = touch(find(team, goalie[1]));
			if (g && team) goalieFor.set(team, g);
			continue;
		}
		const clear = text.match(/^Clear attempt by \S+ (good|failed)/i);
		if (clear && team) {
			const c = clears.get(team) ?? { good: 0, attempts: 0 };
			c.attempts++;
			if (clear[1].toLowerCase() === "good") c.good++;
			clears.set(team, c);
			continue;
		}
		const fo = text.match(FACEOFF_RE);
		if (fo) {
			const a = touch(find(null, fo[1]));
			const b = touch(find(null, fo[2]));
			for (const p of [a, b]) {
				if (p) p.faceoffsTaken = (p.faceoffsTaken ?? 0) + 1;
			}
			const winner =
				a && a.teamId === team ? a : b && b.teamId === team ? b : null;
			if (winner) winner.faceoffsWon = (winner.faceoffsWon ?? 0) + 1;
			for (const gb of text.matchAll(GB_RE)) {
				const p = touch(find(team, gb[1]));
				if (p) p.groundBalls++;
			}
			continue;
		}
		switch (play.type) {
			case "goal": {
				const m = text.match(GOAL_RE);
				if (!m) break;
				const scorer = touch(find(team, m[1]));
				if (scorer) {
					scorer.goals++;
					scorer.shots++;
					scorer.shotsOnGoal++;
					scorer.points++;
				}
				if (m[2]) {
					const a = touch(find(team, m[2]));
					if (a) {
						a.assists++;
						a.points++;
					}
				}
				const g = team ? goalieFor.get(other(team)) : null;
				if (g) g.goalsAllowed = (g.goalsAllowed ?? 0) + 1;
				break;
			}
			case "save": {
				const m = text.match(SAVE_RE);
				if (!m) break;
				const shooter = touch(find(team, m[1]));
				if (shooter) {
					shooter.shots++;
					shooter.shotsOnGoal++;
				}
				const g =
					touch(find(team ? other(team) : null, m[2])) ??
					(team ? (goalieFor.get(other(team)) ?? null) : null);
				if (g) g.saves = (g.saves ?? 0) + 1;
				break;
			}
			case "shot": {
				const m = text.match(SHOT_RE);
				const shooter = m ? touch(find(team, m[1])) : null;
				if (shooter) shooter.shots++;
				break;
			}
			case "groundball": {
				for (const gb of text.matchAll(GB_RE)) {
					const p = touch(find(team, gb[1]));
					if (p) p.groundBalls++;
				}
				break;
			}
			case "turnover": {
				const m = text.match(TURNOVER_RE);
				if (!m) break;
				const p = touch(find(team, m[1].trim()));
				if (p) p.turnovers++;
				if (m[2]) {
					const c = touch(find(team ? other(team) : null, m[2]));
					if (c) c.causedTurnovers++;
				}
				break;
			}
			case "penalty": {
				const m = text.match(PENALTY_RE);
				if (!m) break;
				const p = touch(find(team, m[1]));
				if (p) {
					const cur = p.penalties ?? { count: 0, minutes: 0 };
					p.penalties = {
						count: cur.count + 1,
						minutes: cur.minutes + Number(m[2]) + Number(m[3]) / 60,
					};
				}
				break;
			}
			default: {
				const m = text.match(DRAW_RE);
				if (m) {
					const p = touch(find(team, m[1]));
					if (p) p.drawControls++;
				}
			}
		}
	}

	const teamStats: V1TeamLine[] = final.teamStats.map((line) => {
		const mine = players.filter((p) => p.teamId === line.teamId);
		const theirs = players.filter((p) => p.teamId !== line.teamId);
		const sum = (f: (p: V1PlayerLine) => number | null) =>
			mine.reduce((n, p) => n + (f(p) ?? 0), 0);
		const c = clears.get(line.teamId);
		return {
			...line,
			goals: sum((p) => p.goals),
			assists: sum((p) => p.assists),
			shots: sum((p) => p.shots),
			shotsOnGoal: sum((p) => p.shotsOnGoal),
			groundBalls: sum((p) => p.groundBalls),
			turnovers: sum((p) => p.turnovers),
			causedTurnovers: sum((p) => p.causedTurnovers),
			drawControls:
				line.drawControls === null ? null : sum((p) => p.drawControls),
			faceoffsWon: line.faceoffsWon === null ? null : sum((p) => p.faceoffsWon),
			faceoffsLost:
				line.faceoffsLost === null
					? null
					: theirs.reduce((n, p) => n + (p.faceoffsWon ?? 0), 0),
			clears: line.clears === null ? null : (c?.good ?? 0),
			clearAttempts: line.clearAttempts === null ? null : (c?.attempts ?? 0),
			saves: line.saves === null ? null : sum((p) => p.saves),
			goalsAllowed:
				line.goalsAllowed === null ? null : sum((p) => p.goalsAllowed),
			penalties: line.penalties
				? {
						count: sum((p) => p.penalties?.count ?? 0),
						minutes:
							Math.round(sum((p) => p.penalties?.minutes ?? 0) * 100) / 100,
					}
				: null,
			extraMan: line.extraMan ? { goals: 0, opportunities: 0 } : null,
		};
	});

	return { ...final, status, players, teamStats, updatedAt };
}

function boxscorePayload(
	g: ReplayGame,
	v: number,
	now: number,
): V1Boxscore | null {
	if (!g.boxscore) return null;
	const game = gameAt(g, v, now);
	const status = {
		state: game.status.state,
		period: game.status.period,
		clock: game.status.clock,
	};
	if (game.status.state === "final") return g.boxscore;
	return boxscoreFromPlays(g.boxscore, playsAt(g, v), status, game.updatedAt);
}

function findGame(id: string): ReplayGame | null {
	return run?.games.find((g) => g.final.id === id) ?? null;
}

/** Replayed games for a board, or null when replay is off / not this board. */
export function replayBoard(
	sport: string,
	division: string,
	date: string,
	now = Date.now(),
): V1Game[] | null {
	if (!run) return null;
	const v = virtualMs(now);
	const games = run.games
		.filter((g) => g.final.sport === sport && g.final.division === division)
		.map((g) => gameAt(g, v, now))
		.filter((g) => g.date === date);
	return games.length ? games : null;
}

export function replayGame(id: string, now = Date.now()): V1Game | null {
	const g = findGame(id);
	return g ? gameAt(g, virtualMs(now), now) : null;
}

export function replayPlays(id: string, now = Date.now()): V1Plays | null {
	const g = findGame(id);
	return g ? playsPayload(g, virtualMs(now), now) : null;
}

export function replayBoxscore(
	id: string,
	now = Date.now(),
): V1Boxscore | null {
	const g = findGame(id);
	return g ? boxscorePayload(g, virtualMs(now), now) : null;
}

export function replayLive(now = Date.now()): V1Game[] {
	if (!run) return [];
	const v = virtualMs(now);
	return run.games
		.map((g) => gameAt(g, v, now))
		.filter((g) => g.status.state === "live");
}

/** Publish diffs for every replayed game; stops the run once all are final. */
export function replayTick(now = Date.now()): void {
	if (!run) return;
	const v = virtualMs(now);
	let allFinal = true;
	for (const g of run.games) {
		const game = gameAt(g, v, now);
		if (game.status.state !== "final") allFinal = false;
		publishGame(g.lastServed, game);
		g.lastServed = game;
		const count = playsAt(g, v).length;
		if (count !== g.lastPlayCount) {
			g.lastPlayCount = count;
			publishDetails(game, ["plays", "boxscore"]);
		}
	}
	if (
		allFinal &&
		v - Math.max(...run.games.map((g) => g.tipMs + g.endMs)) > 5 * 60_000
	) {
		stopReplay();
	}
}

export async function startReplay(
	options: ReplayOptions,
	sports: readonly string[],
	divisions: readonly string[],
	now = Date.now(),
): Promise<ReplayStatus> {
	stopReplay();
	const opts: Required<ReplayOptions> = {
		date: options.date,
		sports: options.sports ?? [...sports],
		divisions: options.divisions ?? [...divisions],
		games: options.games ?? [],
		speed: options.speed && options.speed > 0 ? options.speed : 1,
		leadSec: options.leadSec ?? 60,
		staggerSec: options.staggerSec ?? 120,
		limit: options.limit ?? 12,
	};
	const candidates: V1Game[] = [];
	for (const sport of opts.sports) {
		for (const division of opts.divisions) {
			const stored = await listGames(sport, division, opts.date);
			for (const s of stored) {
				if (s.game.status.state !== "final") continue;
				if (opts.games.length && !opts.games.includes(s.game.id)) continue;
				candidates.push(s.game);
			}
		}
	}
	candidates.sort((a, b) => (a.startEpoch ?? 0) - (b.startEpoch ?? 0));

	const games: ReplayGame[] = [];
	for (const final of candidates) {
		if (games.length >= opts.limit) break;
		const [plays, box] = await Promise.all([
			getDetail<V1Plays>(final.id, "plays"),
			getDetail<V1Boxscore>(final.id, "boxscore"),
		]);
		if (!plays || plays.data.plays.length < 10) continue;
		const elapsed = plays.data.plays.map(playElapsedMs);
		const endMs = Math.max(...elapsed) + 1_000;
		games.push({
			final,
			plays: plays.data,
			boxscore: box?.data ?? null,
			tipMs: (opts.leadSec + games.length * opts.staggerSec) * 1000,
			endMs,
			elapsed,
			lastServed: null,
			lastPlayCount: 0,
		});
	}
	if (!games.length) {
		throw new Error(`no stored games with play-by-play on ${opts.date}`);
	}
	run = { options: opts, startedAt: now, games };
	replayTick(now);
	timer = setInterval(() => replayTick(), TICK_MS);
	return replayStatus(now);
}

export function stopReplay(): ReplayStatus {
	if (timer) clearInterval(timer);
	timer = null;
	if (run) {
		const now = Date.now();
		// tell listeners the replayed games are gone by finalizing them
		for (const g of run.games) {
			if (g.lastServed && g.lastServed.status.state !== "final") {
				publishGame(g.lastServed, {
					...shiftedBase(g),
					updatedAt: new Date(now).toISOString(),
				});
			}
		}
	}
	run = null;
	return replayStatus();
}
