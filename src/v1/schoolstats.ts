import * as cheerio from "cheerio";
import { getBio, upsertBio } from "../store";
import { upstreamFetch } from "../upstream";
import { hostOf, PATHS, resolveHost } from "./rosterbio";
import type { Sport, V1RosterPlayer } from "./teams";

/*
 * Season stat totals from each school's own stats page
 * (/sports/<code>/stats/<season>). These are the official numbers: lax.com
 * lines miss some GB/CT, and NCAA women's box scores barely record GB/TO.
 * Two Sidearm flavours are read:
 *   classic  server-rendered "Individual Overall Scoring/Goalkeeping" tables
 *   nuxt     `overallIndividualStats` inside the `__NUXT_DATA__` devalue array
 * Anything else yields null and callers keep the lax.com totals.
 */

export type PlayerStats = V1RosterPlayer["stats"];

export interface SchoolStatLine {
	number: string | null;
	name: string;
	gamesPlayed: number | null;
	gamesStarted: number | null;
	stats: PlayerStats;
}

export interface StoredSchoolStats {
	host: string;
	url: string;
	source: "sidearm_classic" | "sidearm_nuxt";
	season: string;
	players: SchoolStatLine[];
}

/** Current-season hits are refetched this often while games are being played. */
export const STATS_REFRESH_MS = 6 * 60 * 60 * 1000;
export const STATS_MISS_REFRESH_MS = 24 * 60 * 60 * 1000;

export const schoolStatsStats = {
	fetched: 0,
	parsed: 0,
	errors: 0,
	lastError: null as string | null,
};

export const statsKey = (sport: Sport, teamId: string, season: string) =>
	`stats:${sport}:${teamId}:${season}`;

export function statsAreFresh(
	stored: { data: unknown; updatedAt: string } | null,
	season: string,
	now = new Date(),
): boolean {
	if (!stored) return false;
	// A finished season's totals never change once parsed.
	if (stored.data && Number(season) < now.getUTCFullYear()) return true;
	const age = now.getTime() - new Date(stored.updatedAt).getTime();
	return age < (stored.data ? STATS_REFRESH_MS : STATS_MISS_REFRESH_MS);
}

const int = (v: unknown): number => {
	const x = Number(String(v ?? "").trim());
	return Number.isFinite(x) ? x : 0;
};
const optInt = (v: unknown): number | null => {
	const s = String(v ?? "").trim();
	return /^\d+$/.test(s) ? Number(s) : null;
};
/** "19-12" → [19, 12] (GP-GS, faceoffs W-T). */
const pair = (v: unknown): [number | null, number | null] => {
	const [a, b] = String(v ?? "").split("-");
	return [optInt(a), optInt(b)];
};

/** "Meltcher, Brooke" → "Brooke Meltcher". */
export function statPersonName(raw: string): string {
	const s = raw.replace(/\s+/g, " ").trim();
	const i = s.indexOf(",");
	return i > 0 ? `${s.slice(i + 1).trim()} ${s.slice(0, i).trim()}` : s;
}

const NOT_A_PLAYER = /^(team|totals?|opponents?)$/i;

const emptyStats = (): PlayerStats => ({
	goals: 0,
	assists: 0,
	shots: 0,
	groundBalls: 0,
	turnovers: 0,
	causedTurnovers: 0,
	faceoffsWon: 0,
	faceoffsTaken: 0,
	saves: 0,
	shotsFaced: 0,
});

export function parseSidearmClassicStats(
	html: string,
	sport: Sport,
): SchoolStatLine[] | null {
	const $ = cheerio.load(html);
	const tableRows = (caption: string): Record<string, string>[] => {
		const table = $("caption")
			.filter((_, el) => $(el).text().trim().toLowerCase() === caption)
			.first()
			.closest("table");
		if (!table.length) return [];
		const heads = table
			.find("thead th")
			.toArray()
			.map((th) => $(th).text().trim().toUpperCase());
		return table
			.find("tbody > tr")
			.toArray()
			.map((tr) => {
				const row: Record<string, string> = {};
				$(tr)
					.children("td")
					.each((i, td) => {
						const h = heads[i];
						if (!h) return;
						const cell = $(td);
						row[h] =
							h === "PLAYER"
								? (cell.find("a, button").first().text() || cell.text()).trim()
								: cell.text().trim();
					});
				return row;
			});
	};
	const players: SchoolStatLine[] = [];
	const find = (number: string | null, name: string) =>
		players.find((p) => p.name === name && p.number === number);
	for (const r of tableRows("individual overall scoring statistics")) {
		const name = statPersonName(r.PLAYER ?? "");
		if (!name || NOT_A_PLAYER.test(name)) continue;
		const number = r["#"] || null;
		if (find(number, name)) continue;
		const [gp, gs] = pair(r["GP-GS"]);
		const stats = emptyStats();
		stats.goals = int(r.G);
		stats.assists = int(r.A);
		stats.shots = int(r.SH);
		stats.groundBalls = int(r.GB);
		stats.turnovers = int(r.TO);
		stats.causedTurnovers = int(r.CT);
		if (sport === "lacrosse-women") {
			// lax.com reports draw controls as faceoffs won = taken; keep that shape.
			stats.faceoffsWon = int(r.DC);
			stats.faceoffsTaken = int(r.DC);
		} else {
			const [won, taken] = pair(r.FO);
			stats.faceoffsWon = won ?? 0;
			stats.faceoffsTaken = taken ?? 0;
		}
		players.push({ number, name, gamesPlayed: gp, gamesStarted: gs, stats });
	}
	for (const r of tableRows("individual overall goalkeeping statistics")) {
		const name = statPersonName(r.PLAYER ?? "");
		if (!name || NOT_A_PLAYER.test(name)) continue;
		const number = r["#"] || null;
		let p = find(number, name);
		if (!p) {
			const [gp, gs] = pair(r["GP-GS"]);
			p = {
				number,
				name,
				gamesPlayed: gp,
				gamesStarted: gs,
				stats: emptyStats(),
			};
			players.push(p);
		}
		p.stats.saves = int(r.SV);
		p.stats.shotsFaced = r.SF ? int(r.SF) : int(r.SV) + int(r.GA);
	}
	return players.length ? players : null;
}

type Devalue = unknown[];
const WRAPPERS = new Set([
	"Reactive",
	"ShallowReactive",
	"Ref",
	"ShallowRef",
	"EmptyRef",
	"EmptyShallowRef",
]);

/** Resolve a devalue index into a plain value (bounded depth). */
function resolve(arr: Devalue, i: unknown, depth = 0): unknown {
	if (typeof i !== "number" || !Number.isInteger(i) || i < 0) return null;
	if (depth > 12 || i >= arr.length) return null;
	const v = arr[i];
	if (Array.isArray(v)) {
		if (typeof v[0] === "string") {
			return WRAPPERS.has(v[0]) ? resolve(arr, v[1], depth + 1) : null;
		}
		return v.map((x) => resolve(arr, x, depth + 1));
	}
	if (v && typeof v === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, x] of Object.entries(v)) out[k] = resolve(arr, x, depth + 1);
		return out;
	}
	return v;
}

interface NuxtStatRow {
	isAFooterStat?: boolean;
	playerName?: string | null;
	playerUniform?: string | number | null;
	gamesPlayed?: string | null;
	gamesStarted?: string | null;
	shotStats?: Record<string, string | null> | null;
	miscStats?: Record<string, string | null> | null;
	goalieStats?: Record<string, string | null> | null;
}

export function parseSidearmNuxtStats(
	html: string,
	sport: Sport,
): SchoolStatLine[] | null {
	const m = html.match(
		/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
	);
	if (!m) return null;
	let arr: Devalue;
	try {
		arr = JSON.parse(m[1]) as Devalue;
	} catch {
		return null;
	}
	if (!Array.isArray(arr)) return null;
	const holder = arr.find(
		(o) =>
			!!o &&
			typeof o === "object" &&
			!Array.isArray(o) &&
			"overallIndividualStats" in o,
	) as { overallIndividualStats: unknown } | undefined;
	if (!holder) return null;
	const overall = resolve(arr, holder.overallIndividualStats) as {
		stats?: NuxtStatRow[] | null;
	} | null;
	const players: SchoolStatLine[] = [];
	for (const r of overall?.stats ?? []) {
		if (!r || r.isAFooterStat) continue;
		const name = statPersonName(r.playerName ?? "");
		if (!name || NOT_A_PLAYER.test(name)) continue;
		const shot = r.shotStats ?? {};
		const misc = r.miscStats ?? {};
		const goalie = r.goalieStats ?? {};
		const stats = emptyStats();
		stats.goals = int(shot.goals);
		stats.assists = int(shot.assists);
		stats.shots = int(shot.shots);
		stats.groundBalls = int(misc.groundBalls);
		stats.turnovers = int(misc.turnovers);
		stats.causedTurnovers = int(misc.causedTurnovers);
		if (sport === "lacrosse-women") {
			stats.faceoffsWon = int(misc.drawControls);
			stats.faceoffsTaken = int(misc.drawControls);
		} else {
			stats.faceoffsWon = int(misc.faceoffsWon);
			stats.faceoffsTaken = int(misc.faceoffsWon) + int(misc.faceoffsLost);
		}
		stats.saves = int(goalie.saves);
		stats.shotsFaced = goalie.shotsFaced
			? int(goalie.shotsFaced)
			: int(goalie.saves) + int(goalie.goalsAllowed);
		const num = r.playerUniform;
		players.push({
			number: num == null || num === "" ? null : String(num),
			name,
			gamesPlayed: optInt(r.gamesPlayed),
			gamesStarted: optInt(r.gamesStarted),
			stats,
		});
	}
	return players.length ? players : null;
}

export function parseStatsHtml(
	html: string,
	sport: Sport,
): Pick<StoredSchoolStats, "source" | "players"> | null {
	const nuxt = parseSidearmNuxtStats(html, sport);
	if (nuxt) return { source: "sidearm_nuxt", players: nuxt };
	const classic = parseSidearmClassicStats(html, sport);
	return classic ? { source: "sidearm_classic", players: classic } : null;
}

export const statsUrls = (host: string, sport: Sport, season: string) =>
	PATHS[sport].map((p) => `https://${host}/sports/${p}/stats/${season}`);

export async function fetchSchoolStats(
	host: string,
	sport: Sport,
	season: string,
): Promise<StoredSchoolStats | null> {
	const resolved = await resolveHost(host);
	for (const url of statsUrls(resolved, sport, season)) {
		let res: Response;
		try {
			res = await upstreamFetch(url, {
				retries: 0,
				timeoutMs: 20000,
				headers: { Accept: "text/html,*/*;q=0.8" },
			});
		} catch (err) {
			schoolStatsStats.errors++;
			schoolStatsStats.lastError =
				err instanceof Error ? err.message : String(err);
			continue;
		}
		schoolStatsStats.fetched++;
		// Unknown seasons redirect to the schedule or render an empty table.
		if (!res.ok || !res.url.includes(`/stats/${season}`)) continue;
		const parsed = parseStatsHtml(await res.text(), sport);
		if (!parsed) continue;
		schoolStatsStats.parsed++;
		return { host: resolved, url, season, ...parsed };
	}
	return null;
}

const inflight = new Map<string, Promise<void>>();

/**
 * Stored school totals for a team-season. Stale or missing entries are
 * refreshed in the background; team pages never wait on a school site.
 */
export async function getSchoolStats(
	sport: Sport,
	teamId: string,
	website: string | null,
	season: string,
): Promise<StoredSchoolStats | null> {
	const stored = await getBio<StoredSchoolStats | null>(
		statsKey(sport, teamId, season),
	);
	if (!statsAreFresh(stored, season))
		void refreshSchoolStats(sport, teamId, website, season);
	return stored?.data ?? null;
}

export function refreshSchoolStats(
	sport: Sport,
	teamId: string,
	website: string | null,
	season: string,
): Promise<void> {
	const key = statsKey(sport, teamId, season);
	const running = inflight.get(key);
	if (running) return running;
	const host = hostOf(website);
	const job = (async () => {
		const stats = host ? await fetchSchoolStats(host, sport, season) : null;
		const prev = await getBio<StoredSchoolStats | null>(key);
		// A transient failure never wipes totals already parsed.
		if (!stats && prev?.data) return;
		await upsertBio(key, stats);
	})()
		.catch((err) => {
			schoolStatsStats.errors++;
			schoolStatsStats.lastError =
				err instanceof Error ? err.message : String(err);
		})
		.finally(() => inflight.delete(key));
	inflight.set(key, job);
	return job;
}
