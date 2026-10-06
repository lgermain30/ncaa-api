import * as cheerio from "cheerio";
import { getBio, upsertBio } from "../store";
import { upstreamFetch } from "../upstream";
import type { Sport } from "./teams";

/*
 * Player bios (height, weight, high school) come from each school's own
 * athletics site: lax.com and NCAA publish neither. Most schools run Sidearm
 * Sports, in one of two flavours:
 *   classic  server-rendered HTML with `sidearm-roster-player-*` classes
 *   nuxt     a `__NUXT_DATA__` devalue array holding roster player objects
 * Everything else is left alone (bio fields stay null). Results are stored in
 * Postgres per team and refreshed at most every REFRESH_MS.
 */

export interface BioPlayer {
	number: string | null;
	name: string;
	position: string | null;
	year: string | null;
	hometown: string | null;
	height: string | null;
	weight: number | null;
	highSchool: string | null;
}

export interface StoredRosterBio {
	host: string;
	source: "sidearm_classic" | "sidearm_nuxt";
	/** roster year the school page is showing (e.g. "2027"), when detectable */
	season: string | null;
	players: BioPlayer[];
}

export const REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
const PATHS: Record<Sport, string[]> = {
	"lacrosse-men": ["mens-lacrosse", "mlax", "mens-lax", "lacrosse"],
	"lacrosse-women": ["womens-lacrosse", "wlax", "womens-lax", "lacrosse"],
};

export const rosterBioStats = {
	fetched: 0,
	parsed: 0,
	unsupported: 0,
	errors: 0,
	lastError: null as string | null,
};

export function bioKey(sport: Sport, teamId: string, season?: string) {
	return season ? `${sport}:${teamId}:${season}` : `${sport}:${teamId}`;
}

export function hostOf(website: string | null): string | null {
	if (!website) return null;
	try {
		const u = new URL(
			website.startsWith("http") ? website : `http://${website}`,
		);
		return u.hostname.replace(/^www\./, "") || null;
	} catch {
		return null;
	}
}

const clean = (s: string | null | undefined) =>
	(s ?? "").replace(/\s+/g, " ").trim();

/** `6'3"`, `6-3`, `6' 3''` -> `6'3"`; anything else null. */
export function normalizeHeight(raw: string | null | undefined): string | null {
	const m = clean(raw).match(/(\d)\s*['’-]\s*(\d{1,2})/);
	return m ? `${m[1]}'${m[2]}"` : null;
}

export function normalizeWeight(raw: string | number | null | undefined) {
	const n = Number.parseInt(String(raw ?? "").replace(/[^\d]/g, ""), 10);
	return Number.isFinite(n) && n >= 80 && n <= 400 ? n : null;
}

export function parseSidearmClassic(html: string): BioPlayer[] | null {
	const $ = cheerio.load(html);
	const items = $("li.sidearm-roster-player");
	if (!items.length) return null;
	const players: BioPlayer[] = [];
	items.each((_, el) => {
		const node = $(el);
		const name = clean(
			node
				.find(".sidearm-roster-player-name a, .sidearm-roster-player-name h3")
				.first()
				.text(),
		);
		if (!name) return;
		players.push({
			number:
				clean(
					node.find(".sidearm-roster-player-jersey-number").first().text(),
				) || null,
			name,
			position:
				clean(
					node.find(".sidearm-roster-player-position-long-short").last().text(),
				) || null,
			year:
				clean(
					node.find(".sidearm-roster-player-academic-year").first().text(),
				) || null,
			hometown:
				clean(node.find(".sidearm-roster-player-hometown").first().text()) ||
				null,
			height: normalizeHeight(
				node.find(".sidearm-roster-player-height").first().text(),
			),
			weight: normalizeWeight(
				node.find(".sidearm-roster-player-weight").first().text(),
			),
			highSchool:
				clean(node.find(".sidearm-roster-player-highschool").first().text()) ||
				null,
		});
	});
	return players.length ? players : null;
}

type Devalue = unknown[];

function deref(arr: Devalue, v: unknown): unknown {
	return typeof v === "number" &&
		Number.isInteger(v) &&
		v >= 0 &&
		v < arr.length
		? arr[v]
		: v;
}

function strOf(arr: Devalue, v: unknown): string | null {
	const x = deref(arr, v);
	return typeof x === "string" && x.trim() ? x.trim() : null;
}

function numOf(arr: Devalue, v: unknown): number | null {
	const x = deref(arr, v);
	if (typeof x === "number") return x;
	if (typeof x === "string" && /^\d+$/.test(x)) return Number(x);
	return null;
}

export function parseSidearmNuxt(html: string): BioPlayer[] | null {
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
	const players: BioPlayer[] = [];
	const seen = new Set<string>();
	for (const item of arr) {
		if (!item || typeof item !== "object" || Array.isArray(item)) continue;
		const o = item as Record<string, unknown>;
		if (!("heightFeet" in o) || !("lastName" in o) || !("jerseyNumber" in o))
			continue;
		const name = clean(
			`${strOf(arr, o.firstName) ?? ""} ${strOf(arr, o.lastName) ?? ""}`,
		);
		if (!name) continue;
		const number = strOf(arr, o.jerseyNumber);
		const key = `${number ?? ""}|${name}`;
		if (seen.has(key)) continue;
		seen.add(key);
		const feet = numOf(arr, o.heightFeet);
		const inches = numOf(arr, o.heightInches);
		players.push({
			number,
			name,
			position: strOf(arr, o.positionShort),
			year: strOf(arr, o.academicYearShort),
			hometown: strOf(arr, o.hometown),
			height: feet ? `${feet}'${inches ?? 0}"` : null,
			weight: normalizeWeight(numOf(arr, o.weight)),
			highSchool: strOf(arr, o.highSchool),
		});
	}
	return players.length ? players : null;
}

/** Roster year from the page title ("2027 Men's Lacrosse Roster") or the Sidearm season object. */
export function parseRosterSeason(html: string): string | null {
	const title = html.match(/<title>[^<]*?\b(20\d\d)\b[^<]*<\/title>/);
	if (title) return title[1];
	const m = html.match(
		/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
	);
	if (!m) return null;
	try {
		const arr = JSON.parse(m[1]) as Devalue;
		let best: string | null = null;
		for (const item of arr) {
			if (!item || typeof item !== "object" || Array.isArray(item)) continue;
			const o = item as Record<string, unknown>;
			if (!("startDate" in o) || !("title" in o) || "heightFeet" in o) continue;
			const t = strOf(arr, o.title);
			if (t && /^20\d\d$/.test(t) && (!best || t > best)) best = t;
		}
		return best;
	} catch {
		return null;
	}
}

export function parseRosterHtml(html: string) {
	const season = parseRosterSeason(html);
	const classic = parseSidearmClassic(html);
	if (classic)
		return { source: "sidearm_classic" as const, season, players: classic };
	const nuxt = parseSidearmNuxt(html);
	if (nuxt) return { source: "sidearm_nuxt" as const, season, players: nuxt };
	return null;
}

/**
 * Fetch and parse a school's roster page; null when the site isn't Sidearm.
 * With `season`, the archived `/roster/<season>` page is used and only kept
 * when the page itself says it is that season (Sidearm serves the current
 * roster for unknown seasons).
 */
export async function fetchRosterBio(
	host: string,
	sport: Sport,
	season?: string,
): Promise<StoredRosterBio | null> {
	for (const path of PATHS[sport]) {
		const url = `https://${host}/sports/${path}/roster${season ? `/${season}` : ""}`;
		let res: Response;
		try {
			res = await upstreamFetch(url, {
				retries: 0,
				timeoutMs: 15000,
				headers: { Accept: "text/html,*/*;q=0.8" },
			});
		} catch (err) {
			rosterBioStats.errors++;
			rosterBioStats.lastError =
				err instanceof Error ? err.message : String(err);
			return null;
		}
		rosterBioStats.fetched++;
		if (res.status === 404) continue;
		if (!res.ok) return null;
		const parsed = parseRosterHtml(await res.text());
		if (!parsed) {
			rosterBioStats.unsupported++;
			return null;
		}
		rosterBioStats.parsed++;
		if (season && parsed.season !== season) return null;
		return { host, ...parsed };
	}
	return null;
}

const inflight = new Map<string, Promise<void>>();

/**
 * Stored bio for a team. When missing or older than REFRESH_MS, a refresh is
 * kicked off in the background and the stale/empty value is returned now so
 * team pages never wait on a school website.
 */
export async function getRosterBio(
	sport: Sport,
	teamId: string,
	website: string | null,
	season?: string,
): Promise<StoredRosterBio | null> {
	const key = bioKey(sport, teamId, season);
	const stored = await getBio<StoredRosterBio | null>(key);
	// A past season's roster never changes: once parsed it is kept for good,
	// and only a miss (null) is retried after REFRESH_MS.
	const fresh =
		stored &&
		((season && stored.data) ||
			Date.now() - new Date(stored.updatedAt).getTime() < REFRESH_MS);
	if (!fresh) void refreshRosterBio(sport, teamId, website, season);
	return stored?.data ?? null;
}

export function refreshRosterBio(
	sport: Sport,
	teamId: string,
	website: string | null,
	season?: string,
): Promise<void> {
	const key = bioKey(sport, teamId, season);
	const running = inflight.get(key);
	if (running) return running;
	const host = hostOf(website);
	const job = (async () => {
		const bio = host ? await fetchRosterBio(host, sport, season) : null;
		// Store nulls too so unsupported sites aren't re-hit on every page view.
		await upsertBio(key, bio);
	})().finally(() => inflight.delete(key));
	inflight.set(key, job);
	return job;
}

const lastKey = (s: string) =>
	s
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-z ]/g, "")
		.trim()
		.split(" ")
		.filter(Boolean);

/** Match a lax.com roster row to a bio by name; the jersey number only breaks ties. */
export function matchBio(
	bio: StoredRosterBio | null,
	player: { number: string | null; name: string },
): BioPlayer | null {
	if (!bio) return null;
	const num = player.number ? String(Number(player.number)) : null;
	const parts = lastKey(player.name);
	const last = parts[parts.length - 1];
	const first = parts[0]?.[0];
	const byNumber = num
		? bio.players.filter((p) => p.number && String(Number(p.number)) === num)
		: [];
	const pool = byNumber.length ? byNumber : bio.players;
	const byName = pool.filter((p) => {
		const bp = lastKey(p.name);
		return bp[bp.length - 1] === last && (!first || bp[0]?.[0] === first);
	});
	return byName.length === 1 ? byName[0] : null;
}
