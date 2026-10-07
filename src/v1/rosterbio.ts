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
	source:
		| "sidearm_classic"
		| "sidearm_nuxt"
		| "sidearm_vue"
		| "wmt_nuxt"
		| "presto";
	/** roster year the school page is showing (e.g. "2027"), when detectable */
	season: string | null;
	players: BioPlayer[];
}

export const REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
/** A miss (site unsupported / unreachable) is retried sooner than a hit. */
export const MISS_REFRESH_MS = 24 * 60 * 60 * 1000;

export function bioIsFresh(
	stored: { data: unknown; updatedAt: string } | null,
	season?: string,
): boolean {
	if (!stored) return false;
	if (season && stored.data) return true;
	const age = Date.now() - new Date(stored.updatedAt).getTime();
	return age < (stored.data ? REFRESH_MS : MISS_REFRESH_MS);
}
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

export function parseSidearmNuxt(
	html: string,
): { players: BioPlayer[]; wmt: boolean } | null {
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
	let wmt = false;
	for (const item of arr) {
		if (!item || typeof item !== "object" || Array.isArray(item)) continue;
		const o = item as Record<string, unknown>;
		const sidearm = "heightFeet" in o && "lastName" in o && "jerseyNumber" in o;
		const w = "height_feet" in o && "last_name" in o && "jersey_number" in o;
		if (!sidearm && !w) continue;
		if (w) wmt = true;
		const name = clean(
			`${strOf(arr, w ? o.first_name : o.firstName) ?? ""} ${strOf(arr, w ? o.last_name : o.lastName) ?? ""}`,
		);
		if (!name) continue;
		const rawNum = deref(arr, w ? o.jersey_number : o.jerseyNumber);
		const number =
			typeof rawNum === "number" ? String(rawNum) : strOf(arr, rawNum);
		const key = `${number ?? ""}|${name}`;
		if (seen.has(key)) continue;
		seen.add(key);
		const feet = numOf(arr, w ? o.height_feet : o.heightFeet);
		const inches = numOf(arr, w ? o.height_inches : o.heightInches);
		players.push({
			number,
			name,
			position: w
				? objStr(arr, o.player_position, ["abbreviation", "name"])
				: strOf(arr, o.positionShort),
			year: w ? null : strOf(arr, o.academicYearShort),
			hometown: strOf(arr, o.hometown),
			height: feet ? `${feet}'${inches ?? 0}"` : null,
			weight: normalizeWeight(numOf(arr, o.weight)),
			highSchool: strOf(arr, w ? o.high_school : o.highSchool),
		});
	}
	if (wmt) {
		// WMT lists the player object and its roster entry (which carries the
		// class level) separately; attach years by name.
		for (const item of arr) {
			if (!item || typeof item !== "object" || Array.isArray(item)) continue;
			const o = item as Record<string, unknown>;
			if (!("player_id" in o) || !("class_level" in o)) continue;
			const pl = deref(arr, o.player) as Record<string, unknown> | undefined;
			if (!pl || typeof pl !== "object") continue;
			const name = clean(
				`${strOf(arr, pl.first_name) ?? ""} ${strOf(arr, pl.last_name) ?? ""}`,
			);
			const yr = objStr(arr, o.class_level, ["abbreviation", "name"]);
			const p = players.find((x) => x.name === name && !x.year);
			if (p && yr) p.year = yr;
		}
	}
	return players.length ? { players, wmt } : null;
}

function objStr(arr: Devalue, v: unknown, keys: string[]): string | null {
	const o = deref(arr, v);
	if (!o || typeof o !== "object" || Array.isArray(o)) return null;
	for (const k of keys) {
		const s = strOf(arr, (o as Record<string, unknown>)[k]);
		if (s) return s;
	}
	return null;
}

interface VuePlayer {
	first_name?: string | null;
	last_name?: string | null;
	jersey_number?: string | number | null;
	position_short?: string | null;
	position_long?: string | null;
	academic_year_short?: string | null;
	hometown?: string | null;
	highschool?: string | null;
	height_feet?: number | null;
	height_inches?: number | null;
	weight?: number | string | null;
}

/**
 * Sidearm's Vue list template renders client-side from a `"players":[…]`
 * JSON blob embedded in the page script.
 */
export function parseSidearmVue(html: string): BioPlayer[] | null {
	if (!html.includes("sidearm-roster-list")) return null;
	const start = html.indexOf('"players":[');
	if (start < 0) return null;
	const from = start + '"players":'.length;
	let depth = 0;
	let end = -1;
	let inStr = false;
	for (let i = from; i < html.length; i++) {
		const c = html[i];
		if (inStr) {
			if (c === "\\") i++;
			else if (c === '"') inStr = false;
			continue;
		}
		if (c === '"') inStr = true;
		else if (c === "[") depth++;
		else if (c === "]" && --depth === 0) {
			end = i + 1;
			break;
		}
	}
	if (end < 0) return null;
	let arr: unknown;
	try {
		arr = JSON.parse(html.slice(from, end));
	} catch {
		return null;
	}
	if (!Array.isArray(arr)) return null;
	const players: BioPlayer[] = [];
	for (const raw of arr as VuePlayer[]) {
		if (!raw || typeof raw !== "object" || !("height_feet" in raw)) continue;
		const name = clean(`${raw.first_name ?? ""} ${raw.last_name ?? ""}`);
		if (!name) continue;
		const feet = Number(raw.height_feet) || null;
		players.push({
			number: raw.jersey_number != null ? String(raw.jersey_number) : null,
			name,
			position: clean(raw.position_short ?? raw.position_long) || null,
			year: clean(raw.academic_year_short) || null,
			hometown: clean(raw.hometown) || null,
			height: feet ? `${feet}'${Number(raw.height_inches) || 0}"` : null,
			weight: normalizeWeight(raw.weight),
			highSchool: clean(raw.highschool) || null,
		});
	}
	return players.length ? players : null;
}

/** PrestoSports roster table: `<td data-field="height">…5-10</td>` rows. */
export function parsePresto(html: string): BioPlayer[] | null {
	if (!/prestosports|data-field="hometown"/i.test(html)) return null;
	const $ = cheerio.load(html);
	const rows = $(
		'tr:has([data-field="first_name: :last_name"]), tr:has(th[data-field*="last_name"])',
	);
	if (!rows.length) return null;
	const players: BioPlayer[] = [];
	rows.each((_, el) => {
		const row = $(el);
		const cell = (field: string) => {
			const td = row.find(`[data-field="${field}"]`).first().clone();
			td.find(".label").remove();
			return clean(td.text());
		};
		const name = clean(row.find('[data-field*="last_name"] a').first().text());
		if (!name) return;
		players.push({
			number: cell("number") || null,
			name,
			position: cell("position").replace(/\.$/, "") || null,
			year: cell("year").replace(/\.$/, "") || null,
			hometown: cell("hometown") || null,
			height: normalizeHeight(cell("height")),
			weight: normalizeWeight(cell("weight")),
			highSchool: cell("highschool") || null,
		});
	});
	return players.length ? players : null;
}

/** Roster year from the page title ("2027 Men's Lacrosse Roster") or the Sidearm season object. */
export function parseRosterSeason(html: string): string | null {
	const t = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
	const academic = t.match(/\b(20\d\d)-(\d\d)\b/);
	if (academic) return `${academic[1].slice(0, 2)}${academic[2]}`;
	const title = t.match(/\b(20\d\d)\b/);
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
	if (nuxt)
		return {
			source: nuxt.wmt ? ("wmt_nuxt" as const) : ("sidearm_nuxt" as const),
			season,
			players: nuxt.players,
		};
	const vue = parseSidearmVue(html);
	if (vue) return { source: "sidearm_vue" as const, season, players: vue };
	const presto = parsePresto(html);
	if (presto) return { source: "presto" as const, season, players: presto };
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
	const resolved = await resolveHost(host);
	for (const url of rosterUrls(resolved, sport, season)) {
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
			continue;
		}
		rosterBioStats.fetched++;
		if (!res.ok) continue;
		const parsed = parseRosterHtml(await res.text());
		if (!parsed) {
			rosterBioStats.unsupported++;
			continue;
		}
		if (season && parsed.season !== season) continue;
		rosterBioStats.parsed++;
		return { host: resolved, ...parsed };
	}
	return null;
}

/** Spring season "2026" is academic year "2025-26". */
const academicYear = (season: string) =>
	`${Number(season) - 1}-${season.slice(2)}`;

/** Roster season a school site shows today: next spring once the fall term starts. */
export function currentRosterSeason(now = new Date()): string {
	return String(now.getUTCFullYear() + (now.getUTCMonth() >= 6 ? 1 : 0));
}

/**
 * Candidate roster URLs across the platforms schools use: Sidearm (and WMT)
 * at /sports/<code>/roster[/<season>], Presto at /sports/<code>/<yyyy-yy>/roster.
 */
export function rosterUrls(host: string, sport: Sport, season?: string) {
	const urls: string[] = [];
	for (const path of PATHS[sport]) {
		urls.push(
			`https://${host}/sports/${path}/roster${season ? `/${season}` : ""}`,
		);
	}
	const short = PATHS[sport][1];
	if (season) {
		urls.push(
			`https://${host}/sports/${short}/roster/season/${academicYear(season)}/`,
		);
		urls.push(`https://${host}/sports/${short}/${academicYear(season)}/roster`);
	} else {
		const now = currentRosterSeason();
		const prev = String(Number(now) - 1);
		urls.push(`https://${host}/sports/${short}/${academicYear(now)}/roster`);
		urls.push(`https://${host}/sports/${short}/${academicYear(prev)}/roster`);
		// Many schools open the new academic year with a coaches-only roster
		// page; the previous season's archived roster still names the players.
		for (const path of PATHS[sport])
			urls.push(`https://${host}/sports/${path}/roster/${prev}`);
	}
	return urls;
}

const hostCache = new Map<string, string>();

/**
 * lax.com's team links often point at a school's old domain
 * (suathletics.com → cuse.com). Follow the redirect once and remember it.
 */
export async function resolveHost(host: string): Promise<string> {
	const hit = hostCache.get(host);
	if (hit) return hit;
	let resolved = host;
	try {
		const res = await upstreamFetch(`https://${host}/`, {
			retries: 0,
			timeoutMs: 10000,
			headers: { Accept: "text/html,*/*;q=0.8" },
		});
		const h = hostOf(res.url);
		if (h) resolved = h;
	} catch {
		try {
			const res = await upstreamFetch(`http://${host}/`, {
				retries: 0,
				timeoutMs: 10000,
				headers: { Accept: "text/html,*/*;q=0.8" },
			});
			const h = hostOf(res.url);
			if (h) resolved = h;
		} catch {}
	}
	hostCache.set(host, resolved);
	return resolved;
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
	if (!bioIsFresh(stored, season))
		void refreshRosterBio(sport, teamId, website, season);
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
