import { getLaxSeason, upsertLaxSeason } from "../store";
import type { SchoolStatLine } from "./schoolstats";
import {
	playerName,
	type Sport,
	type V1RosterPlayer,
	type V1TeamGame,
} from "./teams";

/*
 * Older seasons pushed by the cln-teams WordPress plugin
 * (PUT /v1/admin/web-seasons). The website holds stats.ncaa.org's official
 * season stats and results on top of the NCAA finals we store from 2014, so
 * for seasons lax.com never carried it fills games NCAA has no score for and
 * player totals the school site doesn't publish. The site's bot filter blocks
 * server-side reads, so WordPress pushes; keys reuse the lax_seasons table.
 * Website team slugs are NCAA seoNames.
 */

export interface WebSeasonGame {
	date: string;
	home: boolean;
	opponent: string;
	opponentSlug: string | null;
	us: number;
	them: number;
	playoff: string | null;
}

export interface WebSeason {
	sport: Sport;
	season: string;
	slug: string;
	name: string;
	games: WebSeasonGame[];
	players: SchoolStatLine[];
}

export const webSeasonKey = (sport: Sport, season: string, slug: string) =>
	`web:${sport}:${season}:${slug}`;
const webIndexKey = (sport: Sport, slug: string) =>
	`web-index:${sport}:${slug}`;

const str = (v: unknown): string | null =>
	typeof v === "string" && v.trim() ? v.trim() : null;
const int = (v: unknown): number | null => {
	const n = typeof v === "string" && v.trim() ? Number(v) : v;
	return typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : null;
};

function normalizeGame(raw: unknown): WebSeasonGame | null {
	if (!raw || typeof raw !== "object") return null;
	const g = raw as Record<string, unknown>;
	const date = str(g.date);
	const opponent = str(g.opponent);
	const us = int(g.us);
	const them = int(g.them);
	if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !opponent) return null;
	if (us == null || them == null) return null;
	return {
		date,
		home: g.home === true,
		opponent,
		opponentSlug: str(g.opponentSlug),
		us,
		them,
		playoff: str(g.playoff),
	};
}

function normalizePlayer(raw: unknown, women: boolean): SchoolStatLine | null {
	if (!raw || typeof raw !== "object") return null;
	const p = raw as Record<string, unknown>;
	const name = str(p.name);
	if (!name) return null;
	const n = (k: string) => int(p[k]) ?? 0;
	// Same shape as school stats: women's draw controls ride in faceoffsWon.
	const draws = n("drawControls");
	return {
		number: str(p.number),
		name: playerName(name),
		gamesPlayed: int(p.gamesPlayed),
		gamesStarted: int(p.gamesStarted),
		stats: {
			goals: n("goals"),
			assists: n("assists"),
			shots: n("shots"),
			groundBalls: n("groundBalls"),
			turnovers: n("turnovers"),
			causedTurnovers: n("causedTurnovers"),
			faceoffsWon: women ? draws : n("faceoffsWon"),
			faceoffsTaken: women ? draws : n("faceoffsTaken"),
			saves: n("saves"),
			shotsFaced: n("saves") + n("goalsAllowed"),
		},
	};
}

export function normalizeWebSeason(raw: unknown): WebSeason | null {
	if (!raw || typeof raw !== "object") return null;
	const s = raw as Record<string, unknown>;
	const gender = str(s.gender);
	const sport: Sport | null =
		gender === "women"
			? "lacrosse-women"
			: gender === "men"
				? "lacrosse-men"
				: null;
	const season = int(s.season);
	const slug = str(s.slug);
	const name = str(s.name);
	if (!sport || !season || season < 1990 || !slug || !name) return null;
	const women = sport === "lacrosse-women";
	return {
		sport,
		season: String(season),
		slug,
		name,
		games: (Array.isArray(s.games) ? s.games : [])
			.map(normalizeGame)
			.filter((g): g is WebSeasonGame => g !== null),
		players: (Array.isArray(s.players) ? s.players : [])
			.map((p) => normalizePlayer(p, women))
			.filter((p): p is SchoolStatLine => p !== null),
	};
}

export async function ingestWebSeasons(body: {
	seasons?: unknown[];
}): Promise<{ upserted: number; skipped: number }> {
	const all = body.seasons ?? [];
	const seasons = all
		.map(normalizeWebSeason)
		.filter(
			(s): s is WebSeason =>
				s !== null && (s.games.length > 0 || s.players.length > 0),
		);
	for (const s of seasons) {
		await upsertLaxSeason(webSeasonKey(s.sport, s.season, s.slug), s);
		const index = await getLaxSeason<string[]>(webIndexKey(s.sport, s.slug));
		const years = new Set(index?.data ?? []);
		if (!years.has(s.season)) {
			years.add(s.season);
			await upsertLaxSeason(webIndexKey(s.sport, s.slug), [...years].sort());
		}
	}
	return { upserted: seasons.length, skipped: all.length - seasons.length };
}

export async function getWebSeason(
	sport: Sport,
	season: string,
	seoName: string,
): Promise<WebSeason | null> {
	return (
		(await getLaxSeason<WebSeason>(webSeasonKey(sport, season, seoName)))
			?.data ?? null
	);
}

export async function webSeasonYears(
	sport: Sport,
	seoName: string,
): Promise<string[]> {
	return (
		(await getLaxSeason<string[]>(webIndexKey(sport, seoName)))?.data ?? []
	);
}

const DAY = 86_400_000;
const near = (a: string, b: string) =>
	Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) <= DAY;

/**
 * NCAA-finals schedule plus the website's games NCAA has no final for. A web
 * game is the same contest as an NCAA row on a date within a day with the same
 * score (sources slug some opponents differently), so it is never counted twice.
 */
export function mergeWebSchedule(
	ncaa: V1TeamGame[],
	web: WebSeason | null,
	idOf: (seoName: string) => string | null,
): V1TeamGame[] {
	if (!web?.games.length) return ncaa;
	const rows = [...ncaa];
	for (const g of web.games) {
		const dupe = rows.some(
			(r) =>
				r.score &&
				near(r.date, g.date) &&
				r.score.us === g.us &&
				r.score.them === g.them,
		);
		if (dupe) continue;
		rows.push({
			date: g.date,
			time: null,
			opponent: {
				id: g.opponentSlug ? idOf(g.opponentSlug) : null,
				name: g.opponent,
				seoName: g.opponentSlug,
				rank: null,
			},
			home: g.home,
			final: true,
			score: { us: g.us, them: g.them },
			result: g.us > g.them ? "W" : g.us < g.them ? "L" : "T",
			playoff: g.playoff,
			gameId: null,
		});
	}
	return rows.sort((a, b) => a.date.localeCompare(b.date));
}

/** Roster rows from the website's season totals (no bio fields). */
export function rosterFromWeb(web: WebSeason): V1RosterPlayer[] {
	return web.players.map((p, i) => ({
		id: `web-${p.number ?? i}-${p.name}`,
		number: p.number,
		name: p.name,
		position: null,
		year: null,
		hometown: null,
		height: null,
		weight: null,
		highSchool: null,
		previousSchool: null,
		gamesPlayed: p.gamesPlayed,
		gamesStarted: p.gamesStarted,
		stats: p.stats,
	}));
}
