import { getLaxSeason, upsertLaxSeason } from "../store";
import { epochToEtDate } from "./normalize";
import type { V1Game, V1Odds, V1Team } from "./types";

/*
 * Point spreads for NCAA lacrosse from The Odds API (the-odds-api.com,
 * sport `lacrosse_ncaa`). Books only post men's lines, mostly D1. The feed
 * is polled a few times a day (free plan: 500 credits/month, 1 per poll)
 * and only while Odds API marks the sport active; lines are kept after a
 * game starts so finals keep their closing spread.
 */

const API = "https://api.the-odds-api.com/v4/sports";
const SPORT = "lacrosse_ncaa";
const STORE_KEY = `odds:${SPORT}`;
export const ODDS_REFRESH_MS = 3 * 60 * 60 * 1000;
const KEEP_MS = 21 * 24 * 60 * 60 * 1000;
const BOOK_ORDER = [
	"draftkings",
	"fanduel",
	"betmgm",
	"williamhill_us",
	"espnbet",
	"betrivers",
];

export interface OddsEvent {
	id: string;
	commence: string;
	home: string;
	away: string;
	/** Spread for the home and away team, e.g. -2.5 / +2.5 */
	homePoint: number;
	awayPoint: number;
	homePrice: number | null;
	awayPrice: number | null;
	book: string;
	updatedAt: string;
}

interface StoredOdds {
	fetchedAt: string;
	events: OddsEvent[];
}

export const oddsStats = {
	enabled: false,
	active: null as boolean | null,
	lastCheck: null as string | null,
	lastFetch: null as string | null,
	events: 0,
	creditsRemaining: null as number | null,
	errors: 0,
	lastError: null as string | null,
};

let events: OddsEvent[] = [];

interface RawOutcome {
	name: string;
	price?: number;
	point?: number;
}
interface RawEvent {
	id: string;
	commence_time: string;
	home_team: string;
	away_team: string;
	bookmakers?: {
		key: string;
		title: string;
		last_update: string;
		markets?: { key: string; outcomes?: RawOutcome[] }[];
	}[];
}

/** Pick one book's spread per event (DraftKings first, then FanDuel, …). */
export function parseOdds(raw: RawEvent[]): OddsEvent[] {
	const out: OddsEvent[] = [];
	for (const e of raw) {
		const books = [...(e.bookmakers ?? [])].sort((a, b) => {
			const ia = BOOK_ORDER.indexOf(a.key);
			const ib = BOOK_ORDER.indexOf(b.key);
			return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
		});
		for (const b of books) {
			const outcomes = b.markets?.find((m) => m.key === "spreads")?.outcomes;
			const h = outcomes?.find((o) => o.name === e.home_team);
			const a = outcomes?.find((o) => o.name === e.away_team);
			if (typeof h?.point !== "number" || typeof a?.point !== "number")
				continue;
			out.push({
				id: e.id,
				commence: e.commence_time,
				home: e.home_team,
				away: e.away_team,
				homePoint: h.point,
				awayPoint: a.point,
				homePrice: h.price ?? null,
				awayPrice: a.price ?? null,
				book: b.title,
				updatedAt: b.last_update,
			});
			break;
		}
	}
	return out;
}

/** Fresh lines replace old ones; lines for games that dropped off the feed (started) are kept a while. */
export function mergeOdds(
	prev: OddsEvent[],
	next: OddsEvent[],
	now = Date.now(),
): OddsEvent[] {
	const byId = new Map(prev.map((e) => [e.id, e]));
	for (const e of next) byId.set(e.id, e);
	return [...byId.values()].filter(
		(e) => now - Date.parse(e.commence) < KEEP_MS,
	);
}

/*
 * Odds API writes "St." for Saint and a bare "St" for State ("Cleveland St
 * Vikings", "St. John's Red Storm"); NCAA slugs lead with "st-" for Saint.
 */
const norm = (s: string) =>
	s
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/\([^)]*\)/g, (m) => (m === "(md)" ? " maryland " : " "))
		.replace(/^st\b\.?|\bst\./g, "saint")
		.replace(/\bst\b/g, "state")
		.replace(/\bmt\b\.?/g, "mount")
		.replace(/\buniv\b\.?/g, "university")
		.replace(/['’.]/g, "")
		.replace(/&/g, " and ")
		.replace(/[^a-z0-9]+/g, " ")
		.trim();

/** NCAA names to try: "University of Pennsylvania" → "pennsylvania", "albany-ny" → "albany". */
function candidates(team: V1Team): string[] {
	const out = new Set<string>();
	for (const raw of [team.name, team.shortName]) {
		if (!raw) continue;
		const n = norm(raw);
		out.add(n);
		out.add(
			n
				.replace(/^(the )?(university|college) (of )?(the )?/, "")
				.replace(/ (university|college)$/, "")
				.trim(),
		);
	}
	if (team.seoName) {
		const seo = team.seoName.replace(/-/g, " ");
		out.add(norm(seo));
		out.add(norm(seo.replace(/ (ny|nc|md|pa|oh|ca)$/, "")));
	}
	out.delete("");
	return [...out];
}

/**
 * How well an Odds API name ("Syracuse Orange") fits an NCAA team: the
 * length of the longest NCAA name that starts it, or 0. "Penn" never
 * matches "Penn State Nittany Lions".
 */
export function nameScore(oddsName: string, team: V1Team): number {
	const o = norm(oddsName);
	let best = 0;
	for (const c of candidates(team)) {
		if (c.length <= best) continue;
		if (o !== c && !o.startsWith(`${c} `)) continue;
		if (/^(state|saint|tech)\b/.test(o.slice(c.length).trim())) continue;
		best = c.length;
	}
	return best;
}

export function findOdds(game: V1Game, list: OddsEvent[]): V1Odds | null {
	if (game.sport !== "lacrosse-men") return null;
	let best: { e: OddsEvent; flipped: boolean; score: number } | null = null;
	for (const e of list) {
		if (epochToEtDate(Date.parse(e.commence) / 1000) !== game.date) continue;
		for (const flipped of [false, true]) {
			const h = nameScore(flipped ? e.away : e.home, game.home);
			const a = nameScore(flipped ? e.home : e.away, game.away);
			if (h && a && (!best || h + a > best.score))
				best = { e, flipped, score: h + a };
		}
	}
	if (!best) return null;
	const { e, flipped } = best;
	return {
		spread: {
			home: flipped ? e.awayPoint : e.homePoint,
			away: flipped ? e.homePoint : e.awayPoint,
			homePrice: flipped ? e.awayPrice : e.homePrice,
			awayPrice: flipped ? e.homePrice : e.awayPrice,
		},
		book: e.book,
		updatedAt: e.updatedAt,
	};
}

export function withOdds(game: V1Game): V1Game {
	if (!events.length) return game;
	const odds = findOdds(game, events);
	return odds ? { ...game, odds } : game;
}

async function getJson(url: string) {
	const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
	const left = Number(res.headers.get("x-requests-remaining"));
	if (res.headers.has("x-requests-remaining") && Number.isFinite(left))
		oddsStats.creditsRemaining = left;
	if (!res.ok) throw new Error(`odds api HTTP ${res.status}`);
	return res.json();
}

/** One poll: the sports list is free; the odds call (1 credit) only runs in season. */
export async function refreshOdds(key: string, force = false): Promise<void> {
	oddsStats.lastCheck = new Date().toISOString();
	const sports = (await getJson(`${API}?apiKey=${key}`)) as {
		key: string;
		active: boolean;
	}[];
	oddsStats.active = sports.some((s) => s.key === SPORT && s.active);
	if (!oddsStats.active && !force) return;
	const raw = (await getJson(
		`${API}/${SPORT}/odds?apiKey=${key}&regions=us&markets=spreads&oddsFormat=american&dateFormat=iso`,
	)) as RawEvent[];
	events = mergeOdds(events, parseOdds(raw));
	oddsStats.events = events.length;
	oddsStats.lastFetch = new Date().toISOString();
	await upsertLaxSeason(STORE_KEY, {
		fetchedAt: oddsStats.lastFetch,
		events,
	} satisfies StoredOdds);
}

/** Load saved lines, then poll every few hours (skipping a poll a restart already had). */
export async function startOddsRefresh(key = process.env.ODDS_API_KEY) {
	if (!key) return;
	oddsStats.enabled = true;
	const stored = await getLaxSeason<StoredOdds>(STORE_KEY);
	if (stored?.data?.events) {
		events = mergeOdds([], stored.data.events);
		oddsStats.events = events.length;
		oddsStats.lastFetch = stored.data.fetchedAt;
	}
	const tick = () => {
		const last = oddsStats.lastFetch ? Date.parse(oddsStats.lastFetch) : 0;
		if (Date.now() - last < ODDS_REFRESH_MS - 60_000) return;
		refreshOdds(key).catch((err) => {
			oddsStats.errors++;
			oddsStats.lastError = String(err).replace(key, "***");
		});
	};
	tick();
	setInterval(tick, 30 * 60 * 1000);
}
