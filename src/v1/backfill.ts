import { getDetail, listGames } from "../store";
import { UpstreamError } from "../upstream";
import {
	LACROSSE_DIVISIONS,
	LACROSSE_SPORTS,
	refreshBoard,
	refreshDetails,
	serviceStats,
} from "./service";
import type { V1Boxscore } from "./types";

/*
 * Historical backfill: walk every day of a season window for every lacrosse
 * board, pull the scoreboard (+ gamecenter for new games) through the normal
 * refreshBoard path so it lands in Postgres, then pull box score / PBP for
 * finals that don't have them yet. Runs in-process (it needs the same
 * DATABASE_URL as the API) and is driven by POST /v1/admin/backfill.
 *
 * Coverage audit (scripts/audit-history.ts, Sept 2026): scoreboards exist from
 * 2014 (women 2015 missing entirely, 2020 truncated by COVID); box score and
 * play-by-play only from 2022. Earlier seasons return nothing — nothing is
 * invented for them.
 */

export interface BackfillOptions {
	fromSeason: number;
	toSeason: number;
	/** MM-DD window inside each season (lacrosse: Feb 1 – Jun 1). */
	from?: string;
	to?: string;
	sports?: string[];
	divisions?: string[];
	/** Also fetch box score + PBP for finals missing them (default true). */
	details?: boolean;
	/** Skip a board/day that is already stored with only finals (default true). */
	skipStored?: boolean;
}

export interface BackfillProgress {
	running: boolean;
	startedAt: string | null;
	finishedAt: string | null;
	options: BackfillOptions | null;
	current: { season: number; date: string; board: string } | null;
	daysDone: number;
	daysTotal: number;
	boardsSkipped: number;
	gamesSeen: number;
	detailsFetched: number;
	detailsMissing: number;
	upstreamErrors: number;
	perSeason: Record<string, Record<string, number>>;
	lastError: string | null;
	abort: boolean;
}

export const backfillProgress: BackfillProgress = {
	running: false,
	startedAt: null,
	finishedAt: null,
	options: null,
	current: null,
	daysDone: 0,
	daysTotal: 0,
	boardsSkipped: 0,
	gamesSeen: 0,
	detailsFetched: 0,
	detailsMissing: 0,
	upstreamErrors: 0,
	perSeason: {},
	lastError: null,
	abort: false,
};

function* daysBetween(season: number, from: string, to: string) {
	const start = new Date(`${season}-${from}T12:00:00Z`);
	const end = new Date(`${season}-${to}T12:00:00Z`);
	for (let d = start; d <= end; d = new Date(d.getTime() + 86_400_000)) {
		yield d.toISOString().slice(0, 10);
	}
}

function countDays(opts: Required<BackfillOptions>) {
	let n = 0;
	for (let s = opts.fromSeason; s <= opts.toSeason; s++) {
		for (const _ of daysBetween(s, opts.from, opts.to)) n++;
	}
	return n;
}

function bump(season: number, key: string, by = 1) {
	backfillProgress.perSeason[season] ??= {};
	const row = backfillProgress.perSeason[season];
	row[key] = (row[key] ?? 0) + by;
}

/** Details count as present only when the box score carries team stats. */
async function hasDetails(gameId: string) {
	const box = await getDetail<V1Boxscore>(gameId, "boxscore");
	return Boolean(box && box.data.teamStats.length > 0);
}

async function alreadyStored(sport: string, division: string, date: string) {
	const stored = await listGames(sport, division, date);
	return (
		stored.length > 0 && stored.every((g) => g.game.status.state !== "live")
	);
}

async function backfillDay(
	opts: Required<BackfillOptions>,
	season: number,
	date: string,
) {
	for (const sport of opts.sports) {
		for (const division of opts.divisions) {
			if (backfillProgress.abort) return;
			backfillProgress.current = {
				season,
				date,
				board: `${sport}/${division}`,
			};
			try {
				if (opts.skipStored && (await alreadyStored(sport, division, date))) {
					backfillProgress.boardsSkipped++;
					continue;
				}
				const games = await refreshBoard(sport, division, date);
				backfillProgress.gamesSeen += games.length;
				bump(season, `${sport}/${division}`, games.length);
				if (!opts.details) continue;
				for (const game of games) {
					if (game.status.state !== "final") continue;
					if (await hasDetails(game.id)) continue;
					try {
						const got = await refreshDetails(game.id);
						if (got) {
							backfillProgress.detailsFetched++;
							bump(season, "details");
						} else {
							backfillProgress.detailsMissing++;
						}
					} catch (err) {
						if (!(err instanceof UpstreamError)) throw err;
						backfillProgress.upstreamErrors++;
						serviceStats.upstreamFailures++;
					}
				}
			} catch (err) {
				backfillProgress.lastError =
					err instanceof Error ? err.message : String(err);
				if (err instanceof UpstreamError) {
					backfillProgress.upstreamErrors++;
					serviceStats.upstreamFailures++;
				} else {
					console.error("[backfill]", sport, division, date, err);
				}
			}
		}
	}
}

let runToken = 0;

export function startBackfill(input: BackfillOptions): BackfillProgress {
	if (backfillProgress.running) return backfillProgress;
	const token = ++runToken;
	const opts: Required<BackfillOptions> = {
		from: "02-01",
		to: "06-01",
		sports: [...LACROSSE_SPORTS],
		divisions: [...LACROSSE_DIVISIONS],
		details: true,
		skipStored: true,
		...input,
	};
	Object.assign(backfillProgress, {
		running: true,
		startedAt: new Date().toISOString(),
		finishedAt: null,
		options: opts,
		current: null,
		daysDone: 0,
		daysTotal: countDays(opts),
		boardsSkipped: 0,
		gamesSeen: 0,
		detailsFetched: 0,
		detailsMissing: 0,
		upstreamErrors: 0,
		perSeason: {},
		lastError: null,
		abort: false,
	});

	(async () => {
		console.log("[backfill] start", JSON.stringify(opts));
		seasons: for (
			let season = opts.fromSeason;
			season <= opts.toSeason;
			season++
		) {
			for (const date of daysBetween(season, opts.from, opts.to)) {
				if (backfillProgress.abort || token !== runToken) break seasons;
				await backfillDay(opts, season, date);
				if (token !== runToken) return;
				backfillProgress.daysDone++;
			}
		}
		backfillProgress.running = false;
		backfillProgress.current = null;
		backfillProgress.finishedAt = new Date().toISOString();
		console.log(
			"[backfill] done",
			JSON.stringify({
				gamesSeen: backfillProgress.gamesSeen,
				details: backfillProgress.detailsFetched,
				aborted: backfillProgress.abort,
			}),
		);
	})();

	return backfillProgress;
}

export function stopBackfill() {
	if (backfillProgress.running) backfillProgress.abort = true;
	return backfillProgress;
}
