import { listLiveGames } from "./store";
import { UpstreamError } from "./upstream";
import {
	LACROSSE_DIVISIONS,
	LACROSSE_SPORTS,
	refreshBoard,
	refreshDetails,
	todayEt,
} from "./v1/service";

/*
 * Background poller: keeps the store warm so /v1 answers from Postgres/memory
 * instead of hitting NCAA on every request.
 *
 *   boards   today's (and, until 6am ET, yesterday's) lacrosse scoreboards
 *   details  boxscore + PBP for every live game, and once more after a final
 *
 * Cadence adapts: LIVE_INTERVAL while any game is live, IDLE_INTERVAL in
 * season, OFFSEASON_INTERVAL otherwise. One tick never overlaps another.
 */

const LIVE_INTERVAL_MS = Number(process.env.POLL_LIVE_MS) || 20_000;
const IDLE_INTERVAL_MS = Number(process.env.POLL_IDLE_MS) || 120_000;
const OFFSEASON_INTERVAL_MS =
	Number(process.env.POLL_OFFSEASON_MS) || 15 * 60_000;

export const pollerStats = {
	enabled: false,
	running: false,
	ticks: 0,
	lastTickAt: null as string | null,
	lastTickMs: 0,
	nextIntervalMs: 0,
	liveGames: 0,
	boardsPolled: 0,
	detailsPolled: 0,
	errors: 0,
	lastError: null as string | null,
};

let timer: ReturnType<typeof setTimeout> | null = null;
let stopped = true;
const finalsDetailed = new Set<string>();

/** Lacrosse runs roughly Feb–May; poll lazily the rest of the year. */
export function inSeason(now = new Date()): boolean {
	const m = now.getUTCMonth() + 1;
	return m >= 1 && m <= 6;
}

export function boardDates(now = new Date()): string[] {
	const today = todayEt(now);
	const etHour = Number(
		new Intl.DateTimeFormat("en-US", {
			timeZone: "America/New_York",
			hour: "numeric",
			hour12: false,
		}).format(now),
	);
	if (etHour >= 6) return [today];
	const yesterday = new Date(now.getTime() - 24 * 60 * 60_000);
	return [todayEt(yesterday), today];
}

function note(err: unknown) {
	pollerStats.errors++;
	pollerStats.lastError = err instanceof Error ? err.message : String(err);
	if (!(err instanceof UpstreamError)) console.error("[poller]", err);
}

export async function tick(now = new Date()): Promise<void> {
	const started = Date.now();
	pollerStats.running = true;
	try {
		const finals: { id: string; state: string; startEpoch: number | null }[] =
			[];
		for (const date of boardDates(now)) {
			for (const sport of LACROSSE_SPORTS) {
				for (const division of LACROSSE_DIVISIONS) {
					try {
						const games = await refreshBoard(sport, division, date);
						pollerStats.boardsPolled++;
						for (const g of games) {
							if (g.status.state === "final")
								finals.push({
									id: g.id,
									state: "final",
									startEpoch: g.startEpoch,
								});
						}
					} catch (err) {
						note(err);
					}
				}
			}
		}

		const live = await listLiveGames();
		pollerStats.liveGames = live.length;
		for (const { game } of live) {
			try {
				await refreshDetails(game.id);
				pollerStats.detailsPolled++;
				finalsDetailed.delete(game.id);
			} catch (err) {
				note(err);
			}
		}
		await detailRecentFinals(finals, now.getTime());
	} finally {
		pollerStats.running = false;
		pollerStats.ticks++;
		pollerStats.lastTickAt = new Date().toISOString();
		pollerStats.lastTickMs = Date.now() - started;
	}
}

/** Final games get one details pass after they flip so the last goals/saves land. */
export async function detailRecentFinals(
	games: { id: string; state: string; startEpoch: number | null }[],
	now = Date.now(),
) {
	for (const g of games) {
		if (g.state !== "final" || finalsDetailed.has(g.id)) continue;
		const started = g.startEpoch ? g.startEpoch * 1000 : 0;
		if (started && now - started > 6 * 60 * 60_000) {
			finalsDetailed.add(g.id);
			continue;
		}
		try {
			await refreshDetails(g.id);
			pollerStats.detailsPolled++;
			finalsDetailed.add(g.id);
		} catch (err) {
			note(err);
		}
	}
}

export function nextIntervalMs(liveGames: number, now = new Date()): number {
	if (liveGames > 0) return LIVE_INTERVAL_MS;
	return inSeason(now) ? IDLE_INTERVAL_MS : OFFSEASON_INTERVAL_MS;
}

async function loop() {
	if (stopped) return;
	try {
		await tick();
	} catch (err) {
		note(err);
	}
	if (stopped) return;
	const wait = nextIntervalMs(pollerStats.liveGames);
	pollerStats.nextIntervalMs = wait;
	timer = setTimeout(loop, wait);
}

export function startPoller() {
	if (!stopped) return;
	stopped = false;
	pollerStats.enabled = true;
	timer = setTimeout(loop, 1_000);
}

export function stopPoller() {
	stopped = true;
	pollerStats.enabled = false;
	if (timer) clearTimeout(timer);
	timer = null;
}
