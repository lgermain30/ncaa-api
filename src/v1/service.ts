import { getSemaphore } from "@henrygd/semaphore";
import {
	getDetail,
	getGame,
	listGames,
	listLiveGames,
	type StoredDetail,
	type StoredGame,
	upsertDetail,
	upsertGame,
} from "../store";
import { UpstreamError } from "../upstream";
import { publishDetails, publishGame } from "./events";
import {
	fetchGamecenterContest,
	fetchLacrosseBoxscore,
	fetchLacrosseTeamStats,
	fetchPlayByPlay,
	fetchScoreboardContests,
} from "./fetch";
import {
	epochToEtDate,
	linescoreAddsUp,
	linescoreFromPlays,
	normalizeBoxscore,
	normalizeGame,
	normalizePlays,
} from "./normalize";
import { boxscoreFromPlays, boxscoreIsEmpty } from "./pbpbox";
import {
	replayActive,
	replayBoard,
	replayBoxscore,
	replayGame,
	replayLive,
	replayPlays,
} from "./replay";
import type { V1Boxscore, V1Game, V1Plays } from "./types";

/*
 * Read-through service used by both the poller and the /v1 routes:
 * store first, refresh from NCAA when the stored copy is older than the
 * freshness window for the game's state, and always fall back to whatever is
 * stored when NCAA is unreachable.
 */

export const LACROSSE_SPORTS = ["lacrosse-men", "lacrosse-women"] as const;
export const LACROSSE_DIVISIONS = ["d1", "d2", "d3"] as const;

export const serviceStats = {
	scoreboardRefreshes: 0,
	gamecenterRefreshes: 0,
	detailRefreshes: 0,
	upstreamFailures: 0,
	linescoreRepairs: 0,
	lastRefreshAt: null as string | null,
};

const FRESH_MS = {
	live: 20_000,
	pre: 5 * 60_000,
	finalRecent: 2 * 60_000,
	final: 6 * 60 * 60_000,
	pastDay: 6 * 60 * 60_000,
};

/** How long a stored copy of a game/board stays fresh, by its state. */
export function freshnessMs(
	game: Pick<V1Game, "status" | "startEpoch" | "date"> | null,
	now = Date.now(),
): number {
	if (!game) return 0;
	switch (game.status.state) {
		case "live":
			return FRESH_MS.live;
		case "final": {
			const started = game.startEpoch
				? game.startEpoch * 1000
				: Date.parse(`${game.date}T12:00:00-05:00`);
			// keep refreshing shortly after the final so late box-score edits land
			return now - started < 5 * 60 * 60_000
				? FRESH_MS.finalRecent
				: FRESH_MS.final;
		}
		default: {
			const start = game.startEpoch
				? game.startEpoch * 1000
				: Number.POSITIVE_INFINITY;
			// tip-off within 15 minutes: poll like a live game so we catch the start
			return start - now < 15 * 60_000 ? FRESH_MS.live : FRESH_MS.pre;
		}
	}
}

export function todayEt(now = new Date()): string {
	return epochToEtDate(Math.floor(now.getTime() / 1000));
}

function isStale(updatedAt: string, ttlMs: number, now = Date.now()) {
	return now - Date.parse(updatedAt) > ttlMs;
}

// Per-board refresh bookkeeping (in-process; the store is the source of truth).
const boardRefreshedAt = new Map<string, number>();

function boardKey(sport: string, division: string, date: string) {
	return `${sport}/${division}/${date}`;
}

function needsGamecenter(
	game: V1Game,
	previous: V1Game | null,
	now: number,
): boolean {
	if (!previous || !previous.detailed) return true;
	if (game.status.state === "live") return true;
	// went final since we last looked: pick up the final linescore / records
	if (game.status.state === "final" && previous.status.state !== "final")
		return true;
	// finals from more than two days ago don't change; don't re-pull gamecenter
	if (
		game.status.state === "final" &&
		game.date < epochToEtDate(Math.floor(now / 1000) - 2 * 86_400)
	)
		return false;
	// periodic refresh of records/venue for upcoming games
	return isStale(
		previous.updatedAt,
		game.status.state === "final" ? FRESH_MS.final : FRESH_MS.pre * 6,
		now,
	);
}

/**
 * Pull one sport/division/date board from NCAA, merge with what we have, and
 * store. Gamecenter is only fetched for games that need it (first sight, live,
 * just went final, or periodic).
 */
export async function refreshBoard(
	sport: string,
	division: string,
	date: string,
): Promise<V1Game[]> {
	const sem = getSemaphore(`v1:board:${boardKey(sport, division, date)}`);
	await sem.acquire();
	try {
		const contests = await fetchScoreboardContests(sport, division, date);
		serviceStats.scoreboardRefreshes++;
		const now = Date.now();
		const games: V1Game[] = [];
		for (const contest of contests) {
			const id = String(contest.id ?? contest.contestId ?? "");
			if (!id) continue;
			const previous = (await getGame(id))?.game ?? null;
			let game = normalizeGame({
				sport,
				division,
				date,
				scoreboard: contest,
				previous,
			});
			if (needsGamecenter(game, previous, now)) {
				try {
					const gc = await fetchGamecenterContest(id);
					serviceStats.gamecenterRefreshes++;
					if (gc)
						game = normalizeGame({
							sport,
							division,
							date,
							scoreboard: contest,
							gamecenter: gc,
							previous,
						});
				} catch (err) {
					if (!(err instanceof UpstreamError)) throw err;
					serviceStats.upstreamFailures++;
				}
			}
			await upsertGame(game);
			publishGame(previous, game);
			if (game.status.state === "final" && !linescoreAddsUp(game)) {
				const repaired = await repairFromDetails(id);
				if (repaired) game = repaired;
			}
			games.push(game);
		}
		boardRefreshedAt.set(boardKey(sport, division, date), now);
		serviceStats.lastRefreshAt = new Date(now).toISOString();
		return games;
	} finally {
		sem.release();
	}
}

function boardFreshness(
	games: StoredGame[],
	date: string,
	now: number,
): number {
	if (games.some((g) => g.game.status.state === "live")) return FRESH_MS.live;
	const today = todayEt(new Date(now));
	if (date < today) return FRESH_MS.pastDay;
	if (date > today) return FRESH_MS.pre * 6;
	return Math.min(...games.map((g) => freshnessMs(g.game, now)), FRESH_MS.pre);
}

/** A day at least two days back whose games are all over. */
function isSettledPastDay(games: StoredGame[], date: string, now: number) {
	const cutoff = epochToEtDate(Math.floor(now / 1000) - 2 * 86_400);
	return (
		date < cutoff &&
		games.every(
			(g) => g.game.status.state !== "live" && g.game.status.state !== "pre",
		)
	);
}

export interface Served<T> {
	data: T;
	updatedAt: string;
	stale: boolean;
}

/** Games for a board, refreshing from NCAA when the stored copy is stale. */
/** While a replay is running, its games replace/precede the real ones on that board. */
function withReplay(
	sport: string,
	division: string,
	date: string,
	served: Served<V1Game[]>,
): Served<V1Game[]> {
	const replayed = replayBoard(sport, division, date);
	if (!replayed) return served;
	const ids = new Set(replayed.map((g) => g.id));
	return {
		data: [...replayed, ...served.data.filter((g) => !ids.has(g.id))],
		updatedAt: new Date().toISOString(),
		stale: served.stale,
	};
}

export async function getBoard(
	sport: string,
	division: string,
	date: string,
): Promise<Served<V1Game[]>> {
	if (!replayActive()) return getStoredBoard(sport, division, date);
	let served: Served<V1Game[]>;
	try {
		served = await getStoredBoard(sport, division, date);
	} catch (err) {
		if (!(err instanceof UpstreamError)) throw err;
		served = { data: [], updatedAt: new Date().toISOString(), stale: true };
	}
	return withReplay(sport, division, date, served);
}

async function getStoredBoard(
	sport: string,
	division: string,
	date: string,
): Promise<Served<V1Game[]>> {
	const now = Date.now();
	const stored = await listGames(sport, division, date);
	const lastRefresh =
		boardRefreshedAt.get(boardKey(sport, division, date)) ?? 0;
	const storedAt =
		lastRefresh ||
		(stored.length
			? Math.max(...stored.map((g) => Date.parse(g.updatedAt)))
			: 0);
	const fresh =
		stored.length > 0 && now - storedAt <= boardFreshness(stored, date, now);
	if (fresh) {
		return {
			data: stored.map((g) => g.game),
			updatedAt: new Date(storedAt).toISOString(),
			stale: false,
		};
	}
	// Settled past day: answer from the store right away and refresh behind
	// the response, so browsing history never waits on NCAA.
	if (stored.length && isSettledPastDay(stored, date, now)) {
		boardRefreshedAt.set(boardKey(sport, division, date), now);
		refreshBoard(sport, division, date).catch(() => {
			serviceStats.upstreamFailures++;
		});
		return {
			data: stored.map((g) => g.game),
			updatedAt: new Date(storedAt).toISOString(),
			stale: false,
		};
	}
	try {
		const games = await refreshBoard(sport, division, date);
		const at = boardRefreshedAt.get(boardKey(sport, division, date)) ?? now;
		return { data: games, updatedAt: new Date(at).toISOString(), stale: false };
	} catch (err) {
		if (!(err instanceof UpstreamError) || !stored.length) throw err;
		serviceStats.upstreamFailures++;
		return {
			data: stored.map((g) => g.game),
			updatedAt: new Date(storedAt).toISOString(),
			stale: true,
		};
	}
}

/** One game; fetches gamecenter directly when we have never seen the id. */
export async function getGameById(id: string): Promise<Served<V1Game> | null> {
	const replayed = replayActive() ? replayGame(id) : null;
	if (replayed)
		return { data: replayed, updatedAt: replayed.updatedAt, stale: false };
	const now = Date.now();
	const stored = await getGame(id);
	if (
		stored &&
		!isStale(stored.updatedAt, freshnessMs(stored.game, now), now)
	) {
		return { data: stored.game, updatedAt: stored.updatedAt, stale: false };
	}
	try {
		const gc = await fetchGamecenterContest(id);
		serviceStats.gamecenterRefreshes++;
		if (!gc)
			return stored
				? { data: stored.game, updatedAt: stored.updatedAt, stale: false }
				: null;
		const gcAny = gc as { sportUrl?: string; division?: number | string };
		const sport = stored?.game.sport ?? gcAny.sportUrl ?? "";
		const division =
			stored?.game.division ??
			(gcAny.division !== undefined ? `d${gcAny.division}` : "");
		const game = normalizeGame({
			sport,
			division,
			gamecenter: gc,
			previous: stored?.game ?? null,
		});
		await upsertGame(game);
		publishGame(stored?.game ?? null, game);
		return { data: game, updatedAt: game.updatedAt, stale: false };
	} catch (err) {
		if (!(err instanceof UpstreamError) || !stored) throw err;
		serviceStats.upstreamFailures++;
		return { data: stored.game, updatedAt: stored.updatedAt, stale: true };
	}
}

/** Fetch boxscore + team stats + PBP together, normalize, and store both details. */
export async function refreshDetails(
	gameId: string,
): Promise<{ boxscore: V1Boxscore; plays: V1Plays } | null> {
	const sem = getSemaphore(`v1:details:${gameId}`);
	await sem.acquire();
	try {
		const [box, teamStats, pbp] = await Promise.all([
			fetchLacrosseBoxscore(gameId),
			fetchLacrosseTeamStats(gameId),
			fetchPlayByPlay(gameId),
		]);
		serviceStats.detailRefreshes++;
		if (!box && !teamStats && !pbp) return null;
		const plays = normalizePlays(gameId, pbp);
		let boxscore = normalizeBoxscore(gameId, box, teamStats, pbp);
		if (boxscoreIsEmpty(boxscore, plays.plays)) {
			boxscore = boxscoreFromPlays(
				boxscore,
				plays.plays,
				boxscore.status,
				boxscore.updatedAt,
				true,
			);
		}
		await Promise.all([
			upsertDetail(gameId, "boxscore", boxscore),
			upsertDetail(gameId, "plays", plays),
			repairLinescore(gameId, plays),
		]);
		const stored = await getGame(gameId);
		if (stored) publishDetails(stored.game, ["boxscore", "plays"]);
		return { boxscore, plays };
	} finally {
		sem.release();
	}
}

/** First time we see a final with a bad linescore, pull its PBP once to rebuild it. */
const repairAttempted = new Set<string>();
async function repairFromDetails(gameId: string): Promise<V1Game | null> {
	if (repairAttempted.has(gameId)) return null;
	repairAttempted.add(gameId);
	if (await getDetail(gameId, "plays")) return null;
	try {
		await refreshDetails(gameId);
	} catch (err) {
		if (!(err instanceof UpstreamError)) throw err;
		serviceStats.upstreamFailures++;
		return null;
	}
	return (await getGame(gameId))?.game ?? null;
}

/** Replace an NCAA linescore that doesn't sum to the score with one rebuilt from goals. */
async function repairLinescore(gameId: string, plays: V1Plays) {
	const stored = await getGame(gameId);
	if (!stored || linescoreAddsUp(stored.game)) return;
	const derived = linescoreFromPlays(plays.plays);
	if (!derived.length) return;
	const candidate = {
		...stored.game,
		linescore: derived,
		linescoreSource: "pbp" as const,
	};
	if (!linescoreAddsUp(candidate)) return;
	serviceStats.linescoreRepairs++;
	await upsertGame(candidate);
	publishGame(stored.game, candidate);
}

async function detail<T>(
	gameId: string,
	kind: "boxscore" | "plays",
): Promise<Served<T> | null> {
	const now = Date.now();
	const [stored, game] = await Promise.all([
		getDetail<T>(gameId, kind),
		getGame(gameId),
	]);
	const ttl = game ? freshnessMs(game.game, now) : FRESH_MS.pre;
	if (stored && !isStale(stored.updatedAt, ttl, now)) {
		return { data: stored.data, updatedAt: stored.updatedAt, stale: false };
	}
	if (stored && game && isSettledPastDay([game], game.game.date, now)) {
		refreshDetails(gameId).catch(() => {
			serviceStats.upstreamFailures++;
		});
		return { data: stored.data, updatedAt: stored.updatedAt, stale: false };
	}
	try {
		const fresh = await refreshDetails(gameId);
		if (!fresh)
			return stored
				? { data: stored.data, updatedAt: stored.updatedAt, stale: false }
				: null;
		const picked = kind === "boxscore" ? fresh.boxscore : fresh.plays;
		return {
			data: picked as unknown as T,
			updatedAt: picked.updatedAt,
			stale: false,
		};
	} catch (err) {
		if (!(err instanceof UpstreamError) || !stored) throw err;
		serviceStats.upstreamFailures++;
		return { data: stored.data, updatedAt: stored.updatedAt, stale: true };
	}
}

export function getBoxscore(gameId: string) {
	const replayed = replayActive() ? replayBoxscore(gameId) : null;
	if (replayed)
		return Promise.resolve({
			data: replayed,
			updatedAt: replayed.updatedAt,
			stale: false,
		});
	return detail<V1Boxscore>(gameId, "boxscore");
}

export function getPlays(gameId: string) {
	const replayed = replayActive() ? replayPlays(gameId) : null;
	if (replayed)
		return Promise.resolve({
			data: replayed,
			updatedAt: replayed.updatedAt,
			stale: false,
		});
	return detail<V1Plays>(gameId, "plays");
}

export async function getLive(): Promise<Served<V1Game[]>> {
	if (replayActive()) {
		const real = await listLiveGames();
		const replayed = replayLive();
		const ids = new Set(replayed.map((g) => g.id));
		return {
			data: [
				...replayed,
				...real.map((g) => g.game).filter((g) => !ids.has(g.id)),
			],
			updatedAt: new Date().toISOString(),
			stale: false,
		};
	}
	const live = await listLiveGames();
	const updatedAt = live.length
		? new Date(
				Math.max(...live.map((g) => Date.parse(g.updatedAt))),
			).toISOString()
		: (serviceStats.lastRefreshAt ?? new Date(0).toISOString());
	return { data: live.map((g) => g.game), updatedAt, stale: false };
}

export type { StoredDetail };
