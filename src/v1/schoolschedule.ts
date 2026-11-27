import * as cheerio from "cheerio";
import { TieredCache } from "../cache";
import { getBio, upsertBio } from "../store";
import { upstreamFetch } from "../upstream";
import { withPostedSchedule } from "./postedschedules";
import { hostOf, PATHS, resolveHost } from "./rosterbio";
import {
	type Division,
	getTeam,
	getTeams,
	lookupTeam,
	type Sport,
	type V1TeamGame,
} from "./teams";
import type { V1Game, V1Team } from "./types";

/*
 * TV, start time and venue from each school's own schedule page
 * (/sports/<code>/schedule/<season>). NCAA only publishes these for
 * tournament games. Two Sidearm flavours are read:
 *   nuxt     schedule event objects inside the `__NUXT_DATA__` devalue array
 *   classic  server-rendered `.sidearm-schedule-game` rows
 * plus WMT sites (/website-api/schedule-events, located via /schedule?season=YYYY)
 * and PrestoSports sites (`.event-row` cards on /sports/<code>/YYYY-YY/schedule).
 */

export interface SchoolEvent {
	/** YYYY-MM-DD */
	date: string;
	/** "4:00 PM", null when TBA */
	time: string | null;
	tv: string | null;
	venue: string | null;
	/** home / away / neutral from the school's point of view */
	at: "H" | "A" | "N" | null;
	opponent: string;
}

export interface StoredSchoolSchedule {
	host: string;
	url: string;
	source:
		| "sidearm_nuxt"
		| "sidearm_classic"
		| "wmt_api"
		| "presto"
		| "presto_rss";
	season: string;
	events: SchoolEvent[];
}

export const SCHEDULE_REFRESH_MS = 6 * 60 * 60 * 1000;
export const SCHEDULE_MISS_REFRESH_MS = 24 * 60 * 60 * 1000;
/**
 * Bump when a schedule parser learns a new site format: stored misses
 * recorded before this instant are retried at once instead of after the
 * 24h miss window, so newly readable schools fill in on deploy.
 */
export const SCHEDULE_PARSERS_UPDATED = Date.parse("2026-11-27T21:00:00Z");

const scheduleStale = (
	stored: { data: unknown; updatedAt: string } | null | undefined,
): boolean => {
	if (!stored) return true;
	const at = new Date(stored.updatedAt).getTime();
	const age = Date.now() - at;
	if (stored.data) return age > SCHEDULE_REFRESH_MS;
	return age > SCHEDULE_MISS_REFRESH_MS || at < SCHEDULE_PARSERS_UPDATED;
};

export const schoolScheduleStats = {
	fetched: 0,
	parsed: 0,
	errors: 0,
	lastError: null as string | null,
};

export const scheduleKey = (sport: Sport, teamId: string, season: string) =>
	`sched:${sport}:${teamId}:${season}`;

const clean = (s: unknown) =>
	typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "";

/** "1 p.m." / "4:00 PM ET" / "Noon" -> "1:00 PM" / "4:00 PM ET" / "12:00 PM"; TBA -> null. */
export function normalizeTime(raw: unknown): string | null {
	const s = clean(raw);
	if (!s || /\b(tba|tbd)\b/i.test(s)) return null;
	if (/^noon\b/i.test(s)) return "12:00 PM";
	const m = s.match(
		/^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?(?:\s+(E[SD]?T|C[SD]?T|M[SD]?T|P[SD]?T))?/i,
	);
	if (!m) return null;
	const zone = m[4] ? ` ${m[4].toUpperCase()}` : "";
	return `${Number(m[1])}:${m[2] ?? "00"} ${m[3].toUpperCase()}M${zone}`;
}

const atOf = (v: unknown): SchoolEvent["at"] => {
	const s = clean(v).toUpperCase();
	return s === "H" || s === "A" || s === "N" ? s : null;
};

type Devalue = unknown[];

function deref(arr: Devalue, v: unknown): unknown {
	return typeof v === "number" &&
		Number.isInteger(v) &&
		v >= 0 &&
		v < arr.length
		? arr[v]
		: v;
}

function field(arr: Devalue, obj: unknown, key: string): unknown {
	const o = deref(arr, obj);
	return o && typeof o === "object" && !Array.isArray(o)
		? deref(arr, (o as Record<string, unknown>)[key])
		: null;
}

export function parseNuxtSchedule(html: string): SchoolEvent[] | null {
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
	const events: SchoolEvent[] = [];
	for (const item of arr) {
		if (!item || typeof item !== "object" || Array.isArray(item)) continue;
		const o = item as Record<string, unknown>;
		if (!("date" in o && "time" in o && "opponent" in o && "media" in o))
			continue;
		if (!("location_indicator" in o)) continue;
		const date = clean(deref(arr, o.date)).slice(0, 10);
		if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
		events.push({
			date,
			time:
				deref(arr, o.tbd) === true ? null : normalizeTime(deref(arr, o.time)),
			tv: clean(field(arr, o.media, "tv")) || null,
			venue: clean(field(arr, o.facility, "title")) || null,
			at: atOf(deref(arr, o.location_indicator)),
			opponent: clean(field(arr, o.opponent, "title")),
		});
	}
	return events.length ? events : null;
}

const MONTHS = [
	"jan",
	"feb",
	"mar",
	"apr",
	"may",
	"jun",
	"jul",
	"aug",
	"sep",
	"oct",
	"nov",
	"dec",
];

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function parseClassicSchedule(
	html: string,
	season: string,
): SchoolEvent[] | null {
	const $ = cheerio.load(html);
	const events: SchoolEvent[] = [];
	$(".sidearm-schedule-game").each((_, el) => {
		const row = $(el);
		const spans = row
			.find(".sidearm-schedule-game-opponent-date span")
			.map((_, s) => clean($(s).text()))
			.get();
		const dm = (spans[0] ?? "").match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})/);
		const month = dm ? MONTHS.indexOf(dm[1].toLowerCase()) : -1;
		if (!dm || month < 0) return;
		const cls = row.attr("class") ?? "";
		// Fall ball (Aug-Dec) is listed on the spring season's page.
		const year = month >= 7 ? Number(season) - 1 : Number(season);
		// Sites serve the current season for a year they haven't posted; the
		// weekday ("Feb 6 (Sat)") only matches the year the page is really for.
		const wd = (spans[0] ?? "").match(
			/\((sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?\)/i,
		);
		if (
			wd &&
			WEEKDAYS.indexOf(wd[1].toLowerCase()) !==
				new Date(Date.UTC(year, month, Number(dm[2]))).getUTCDay()
		)
			return;
		events.push({
			date: `${year}-${String(month + 1).padStart(2, "0")}-${dm[2].padStart(2, "0")}`,
			time: normalizeTime(spans[1]),
			tv:
				clean(
					row.find(".sidearm-schedule-game-coverage-tv-content").first().text(),
				) || null,
			venue:
				clean(
					row.find(".sidearm-schedule-game-location span").first().text(),
				) || null,
			at: cls.includes("sidearm-schedule-home-game")
				? "H"
				: cls.includes("sidearm-schedule-away-game")
					? "A"
					: cls.includes("sidearm-schedule-neutral-game")
						? "N"
						: null,
			opponent: clean(
				row.find(".sidearm-schedule-game-opponent-name").first().text(),
			),
		});
	});
	return events.length ? events : null;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

export interface WmtEvent {
	datetime?: string | null;
	opponent_name?: string | null;
	venue_type?: string | null;
	tba?: string | null;
	venue?: string | null;
	location?: string | null;
	neutral_event?: boolean | null;
}

/** UTC instant -> the school's local YYYY-MM-DD and "h:mm AM" clock. */
function localParts(
	iso: string,
	tz: string,
): { date: string; time: string } | null {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return null;
	try {
		const parts = new Intl.DateTimeFormat("en-US", {
			timeZone: tz,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "numeric",
			minute: "2-digit",
			hour12: true,
		}).formatToParts(d);
		const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
		return {
			date: `${get("year")}-${get("month")}-${get("day")}`,
			time: `${get("hour")}:${get("minute")} ${get("dayPeriod").toUpperCase()}`,
		};
	} catch {
		return null;
	}
}

/**
 * WMT (Nuxt) athletics sites expose their schedule through
 * /website-api/schedule-events; datetimes are UTC, so they are rendered in
 * the school's time zone (the page's scheduleTimezone).
 */
export function wmtEventsToSchool(
	rows: WmtEvent[],
	tz: string,
): SchoolEvent[] | null {
	const out: SchoolEvent[] = [];
	for (const r of rows) {
		const opponent = clean(r.opponent_name);
		const lp = r.datetime ? localParts(r.datetime, tz) : null;
		if (!opponent || !lp) continue;
		const vt = clean(r.venue_type).toLowerCase();
		out.push({
			date: lp.date,
			time: r.tba ? null : lp.time,
			tv: null,
			venue: clean(r.venue) || clean(r.location) || null,
			at:
				r.neutral_event || vt === "neutral"
					? "N"
					: vt === "home"
						? "H"
						: vt === "away"
							? "A"
							: null,
			opponent,
		});
	}
	return out.length ? out : null;
}

/**
 * PrestoSports schedule pages: `.section-event-month` blocks (month name
 * only) holding `.event-row` cards with "Thu. 4", "6:00 PM EST", venue and
 * an at/vs badge. Season YYYY runs Jul YYYY-1 .. Jun YYYY.
 */
export function parsePrestoSchedule(
	html: string,
	season: string,
): SchoolEvent[] | null {
	const $ = cheerio.load(html);
	const events: SchoolEvent[] = [];
	const side = (txt: string): "H" | "A" | "N" | null => {
		const t = clean(txt).toLowerCase();
		if (t === "vs" || t === "vs." || t === "home" || t === "h") return "H";
		if (t === "at" || t === "away" || t === "a") return "A";
		if (t === "neutral" || t === "n") return "N";
		return null;
	};
	$(".event-row").each((_, row) => {
		const r = $(row);
		const opponent = clean(r.find(".team-name").first().text());
		if (!opponent) return;
		const dateEl = r.find(".date").first();
		let date: string | null = null;
		// "Wed. February 03, 2027"
		const full = clean(dateEl.attr("title")).match(
			/([A-Za-z]+)\.?\s+(\d{1,2}),\s+(\d{4})$/,
		);
		if (full) {
			const m = MONTHS.indexOf(full[1].toLowerCase().slice(0, 3));
			if (m >= 0) date = `${full[3]}-${pad2(m + 1)}-${pad2(Number(full[2]))}`;
		}
		if (!date) {
			// month comes from the enclosing month section / group header
			const header =
				r.closest(".section-event-month").find(".month-title").first().text() ||
				r.closest(".event-group").find(".event-date").first().text();
			const month = MONTHS.indexOf(clean(header).toLowerCase().slice(0, 3));
			const day = clean(dateEl.text()).match(/(\d{1,2})\s*$/);
			if (month < 0 || !day) return;
			const year = month >= 6 ? Number(season) - 1 : Number(season);
			date = `${year}-${pad2(month + 1)}-${pad2(Number(day[1]))}`;
		}
		const venueEl = r.find(".venue").first();
		const venueText = clean(venueEl.text());
		const venueIsSide =
			side(venueText) !== null || side(venueEl.attr("title") ?? "") !== null;
		const at = r.hasClass("neutral")
			? "N"
			: (side(r.find(".event-location-badge").first().text()) ??
				side(r.find(".va").first().text()) ??
				side(venueEl.attr("title") ?? "") ??
				(venueIsSide ? side(venueText) : null));
		events.push({
			date,
			time: normalizeTime(r.find(".status").first().text()),
			tv: null,
			venue: venueIsSide ? null : venueText || null,
			at,
			opponent,
		});
	});
	return events.length ? events : null;
}

export function parseScheduleHtml(
	html: string,
	season: string,
): Pick<StoredSchoolSchedule, "source" | "events"> | null {
	const nuxt = parseNuxtSchedule(html);
	if (nuxt) return { source: "sidearm_nuxt", events: nuxt };
	const classic = parseClassicSchedule(html, season);
	return classic ? { source: "sidearm_classic", events: classic } : null;
}

export async function fetchSchoolSchedule(
	host: string,
	sport: Sport,
	season: string,
): Promise<StoredSchoolSchedule | null> {
	const resolved = await resolveHost(host);
	for (const p of PATHS[sport] ?? []) {
		const url = `https://${resolved}/sports/${p}/schedule/${season}`;
		let res: Response;
		try {
			res = await upstreamFetch(url, {
				retries: 0,
				timeoutMs: 20000,
				headers: { Accept: "text/html,*/*;q=0.8" },
			});
		} catch (err) {
			schoolScheduleStats.errors++;
			schoolScheduleStats.lastError =
				err instanceof Error ? err.message : String(err);
			continue;
		}
		schoolScheduleStats.fetched++;
		if (!res.ok || !res.url.includes("/schedule")) continue;
		const parsed = parseScheduleHtml(await res.text(), season);
		if (!parsed) continue;
		schoolScheduleStats.parsed++;
		return { host: resolved, url, season, ...parsed };
	}
	return (
		(await fetchWmtSchedule(resolved, sport, season)) ??
		(await fetchPrestoSchedule(resolved, sport, season))
	);
}

async function getHtml(url: string): Promise<string | null> {
	let res: Response;
	try {
		res = await upstreamFetch(url, {
			retries: 0,
			timeoutMs: 20000,
			headers: { Accept: "text/html,*/*;q=0.8" },
		});
	} catch (err) {
		schoolScheduleStats.errors++;
		schoolScheduleStats.lastError =
			err instanceof Error ? err.message : String(err);
		return null;
	}
	schoolScheduleStats.fetched++;
	// 202 is the AWS WAF challenge page some Presto sites serve
	if (!res.ok || res.status === 202) return null;
	return res.text();
}

const prevSeasonSlug = (season: string) =>
	`${Number(season) - 1}-${season.slice(2)}`;

async function fetchWmtSchedule(
	host: string,
	sport: Sport,
	season: string,
): Promise<StoredSchoolSchedule | null> {
	for (const p of PATHS[sport] ?? []) {
		for (const q of [season, prevSeasonSlug(season)]) {
			const page = `https://${host}/sports/${p}/schedule?season=${q}`;
			const html = await getHtml(page);
			if (!html || !html.includes("__NUXT_DATA__")) continue;
			// WMT serves its default season when `season` doesn't exist
			const title = clean(html.match(/<title>([^<]*)/)?.[1]).replace(
				/&#x27;|&#39;/g,
				"'",
			);
			if (!title.includes(season) && !title.includes(prevSeasonSlug(season)))
				continue;
			const id = html.match(/"schedule-(\d+)"/)?.[1];
			if (!id) continue;
			const tz =
				html.match(/scheduleTimezone":"([A-Za-z_/]+)"/)?.[1] ??
				"America/New_York";
			const url = `https://${host}/website-api/schedule-events?filter%5Bschedule_id%5D=${id}&per_page=200&sort=datetime`;
			let rows: WmtEvent[];
			try {
				const res = await upstreamFetch(url, { retries: 0, timeoutMs: 20000 });
				schoolScheduleStats.fetched++;
				if (!res.ok) continue;
				rows = ((await res.json()) as { data?: WmtEvent[] }).data ?? [];
			} catch (err) {
				schoolScheduleStats.errors++;
				schoolScheduleStats.lastError =
					err instanceof Error ? err.message : String(err);
				continue;
			}
			const events = wmtEventsToSchool(rows, tz);
			if (!events) continue;
			schoolScheduleStats.parsed++;
			return { host, url, season, source: "wmt_api", events };
		}
	}
	return null;
}

/**
 * PrestoSports RSS (`schedule?print=rss`): CloudFront's bot challenge
 * blocks the HTML on most Presto sites but leaves the feed open.
 * description: "Men's Lacrosse on Feb 6, 2027 at 7:00 PM: Lander vs. Coker"
 * ps:opponent: "Lander" (home) / "at Wingate" (away)
 */
// Ordered so ties break toward the zone with (far) more lacrosse schools:
// e.g. Los Angeles over Phoenix when every timed home game is in DST.
const US_ZONES = [
	"America/New_York",
	"America/Chicago",
	"America/Denver",
	"America/Los_Angeles",
	"America/Anchorage",
	"Pacific/Honolulu",
	"America/Phoenix",
];

export function parsePrestoRss(xml: string): SchoolEvent[] | null {
	const decode = (t: string) =>
		t
			.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
			.replace(/&amp;/g, "&")
			.replace(/&#39;|&apos;/g, "'")
			.replace(/&quot;/g, '"')
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">");
	const tag = (item: string, name: string) => {
		const m = item.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
		return m ? clean(decode(m[1])) : "";
	};
	type Row = SchoolEvent & { instant: string | null };
	const rows: Row[] = [];
	for (const item of xml.match(/<item>[\s\S]*?<\/item>/g) ?? []) {
		const desc = tag(item, "description");
		const m = desc.match(
			/\bon\s+([A-Za-z]+)\.?\s+(\d{1,2}),\s+(\d{4})(?:\s+at\s+(\d{1,2}(?::\d{2})?\s*[AaPp]\.?[Mm]\.?))?/,
		);
		if (!m) continue;
		const month = MONTHS.indexOf(m[1].toLowerCase().slice(0, 3));
		if (month < 0) continue;
		const rawOpp = tag(item, "ps:opponent") || tag(item, "title");
		const away = /^at\s+/i.test(rawOpp);
		// "vs. Wingate @ Charlotte, N.C." is a neutral-site game
		const [oppPart, sitePart] = rawOpp.split(/\s+@\s+/, 2);
		const opponent = clean(oppPart).replace(/^(at|vs\.?)\s+/i, "");
		if (!opponent) continue;
		const site = clean(sitePart);
		rows.push({
			date: `${m[3]}-${pad2(month + 1)}-${pad2(Number(m[2]))}`,
			time: m[4] ? normalizeTime(m[4]) : null,
			tv: null,
			venue: site && !/^tba$/i.test(site) ? site : null,
			at: site ? "N" : away ? "A" : "H",
			opponent,
			instant: tag(item, "dc:date") || null,
		});
	}
	if (!rows.length) return null;
	// The description clock is the venue's local time; dc:date is the UTC
	// instant. Home games tell us the school's zone, which then renders
	// every game on the school's clock (as Sidearm/WMT do).
	const votes = new Map<string, number>();
	for (const r of rows) {
		if (r.at !== "H" || !r.time || !r.instant) continue;
		for (const z of US_ZONES)
			if (localParts(r.instant, z)?.time === r.time)
				votes.set(z, (votes.get(z) ?? 0) + 1);
	}
	const zone = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
	return rows.map(({ instant, ...e }) => {
		if (!e.time || e.at === "H") return e;
		if (zone && instant) {
			const lp = localParts(instant, zone);
			return lp ? { ...e, date: lp.date, time: lp.time } : { ...e, time: null };
		}
		return { ...e, time: null };
	});
}

async function fetchPrestoSchedule(
	host: string,
	sport: Sport,
	season: string,
): Promise<StoredSchoolSchedule | null> {
	for (const p of PATHS[sport] ?? []) {
		const base = `https://${host}/sports/${p}/${prevSeasonSlug(season)}/schedule`;
		const html = await getHtml(base);
		if (html?.includes("event-row")) {
			const events = parsePrestoSchedule(html, season);
			if (events) {
				schoolScheduleStats.parsed++;
				return { host, url: base, season, source: "presto", events };
			}
		}
		const url = `${base}?print=rss`;
		const xml = await getHtml(url);
		if (!xml || !xml.includes("prestosports.com/rss/schedule")) continue;
		const title = clean(xml.match(/<title>([^<]*)/)?.[1]);
		if (!title.includes(season) && !title.includes(prevSeasonSlug(season)))
			continue;
		const events = parsePrestoRss(xml);
		if (!events) continue;
		schoolScheduleStats.parsed++;
		return { host, url, season, source: "presto_rss", events };
	}
	return null;
}

const keyTokens = (s: string) =>
	new Set(
		s
			.toLowerCase()
			.replace(/#\d+(\/#\d+)?|no\.\s*\d+|\(\d+\)/g, " ")
			.replace(/[^a-z0-9 ]/g, " ")
			.split(/\s+/)
			.filter(
				(w) => w.length > 2 && !["university", "college", "the"].includes(w),
			),
	);

/** The school's event for a game on `date` against `opponent`. */
export function matchEvent(
	events: SchoolEvent[],
	date: string,
	opponent: V1Team,
): SchoolEvent | null {
	const sameDay = events.filter((e) => e.date === date);
	if (sameDay.length <= 1) return sameDay[0] ?? null;
	const want = new Set([
		...keyTokens(opponent.name),
		...keyTokens(opponent.shortName),
	]);
	return (
		sameDay.find((e) => [...keyTokens(e.opponent)].some((w) => want.has(w))) ??
		null
	);
}

const inflight = new Map<string, Promise<void>>();

/** School-site fetches run a few at a time so a full board can't flood them. */
const MAX_REFRESHES = 4;
let activeRefreshes = 0;
const waiting: (() => void)[] = [];
async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
	if (activeRefreshes >= MAX_REFRESHES)
		await new Promise<void>((resolve) => waiting.push(resolve));
	activeRefreshes++;
	try {
		return await fn();
	} finally {
		activeRefreshes--;
		waiting.shift()?.();
	}
}

function refreshSchedule(
	sport: Sport,
	division: Division,
	teamId: string,
	season: string,
	website?: string | null,
): Promise<void> {
	const key = scheduleKey(sport, teamId, season);
	const running = inflight.get(key);
	if (running) return running;
	const job = withSlot(async () => {
		const site =
			website !== undefined
				? website
				: (await getTeam(sport, division, teamId, season)).data?.website;
		const host = hostOf(site ?? null);
		const sched = host ? await fetchSchoolSchedule(host, sport, season) : null;
		const prev = await getBio<StoredSchoolSchedule | null>(key);
		if (!sched && prev?.data) return;
		await upsertBio(key, sched);
	})
		.catch((err) => {
			schoolScheduleStats.errors++;
			schoolScheduleStats.lastError =
				err instanceof Error ? err.message : String(err);
		})
		.finally(() => inflight.delete(key));
	inflight.set(key, job);
	return job;
}

/** Stored school schedule; stale or missing entries refresh in the background. */
async function scheduleFor(
	game: V1Game,
	team: V1Team,
): Promise<{ known: boolean; events: SchoolEvent[] }> {
	const sport = game.sport as Sport;
	const division = game.division as Division;
	const season = game.date.slice(0, 4);
	const teamId = await lookupTeam(
		sport,
		division,
		team.seoName || team.shortName,
	);
	if (!teamId) return { known: true, events: [] };
	const stored = await getBio<StoredSchoolSchedule | null>(
		scheduleKey(sport, teamId, season),
	);
	if (scheduleStale(stored)) {void refreshSchedule(sport, division, teamId, season).catch(() => {});
	return { known: !!stored, events: stored?.data?.events ?? [] };
}

type Patch = Partial<Pick<V1Game, "startTime" | "venue">> & {
	network?: string;
};

const patches = new TieredCache("school-schedule-patch", 10 * 60 * 1000);

export function applyPatch(game: V1Game, patch: Patch): V1Game {
	if (!patch.network && !patch.startTime && !patch.venue) return game;
	return {
		...game,
		startTime: patch.startTime ?? game.startTime,
		venue: patch.venue ?? game.venue,
		broadcast: patch.network
			? { ...game.broadcast, network: patch.network }
			: game.broadcast,
	};
}

export function patchFrom(
	game: V1Game,
	home: SchoolEvent | null,
	away: SchoolEvent | null,
): Patch {
	const patch: Patch = {};
	if (!game.broadcast.network) {
		const tv = home?.tv || away?.tv;
		if (tv) patch.network = tv;
	}
	if (!game.startTime || game.startTime === "TBA") {
		const t = home?.time || away?.time;
		if (t) patch.startTime = t;
	}
	if (!game.venue) {
		const v =
			home?.at === "H" ? home.venue : away?.at === "N" ? away.venue : null;
		if (v) patch.venue = { name: v, city: "", state: "" };
	}
	return patch;
}

/** Fill TV, start time and venue NCAA left blank from the schools' schedules. */
export async function withSchoolSchedule(game: V1Game): Promise<V1Game> {
	if (
		game.broadcast.network &&
		game.startTime &&
		game.startTime !== "TBA" &&
		game.venue
	)
		return game;
	const cached = patches.get(game.id) as Patch | undefined;
	if (cached) return applyPatch(game, cached);
	try {
		const [h, a] = await Promise.all([
			scheduleFor(game, game.home),
			scheduleFor(game, game.away),
		]);
		const patch = patchFrom(
			game,
			matchEvent(h.events, game.date, game.away),
			matchEvent(a.events, game.date, game.home),
		);
		if (h.known && a.known) patches.set(game.id, patch);
		return applyPatch(game, patch);
	} catch {
		return game;
	}
}

/** Board version: only upcoming games need TV, start time and venue filled. */
export function withSchoolScheduleBoard(games: V1Game[]): Promise<V1Game[]> {
	return Promise.all(
		games.map((g) =>
			g.status.state === "pre" ? withSchoolSchedule(g) : Promise.resolve(g),
		),
	);
}

/** Fall ball, alumni games and scrimmages share the page with the season. */
const NOT_OFFICIAL = /\b(scrimmage|exhibition|alumni|alumnae|play day)\b/i;

/** "#10/#7 Princeton (Senior Day)" -> "Princeton". */
export function opponentName(raw: string): string {
	return clean(
		raw
			.replace(/^(vs\.?|at|@)\s+/i, "")
			.replace(/^RV\s+/, "")
			.replace(/#\d+(\/#\d+)*|\bno\.\s*\d+\b/gi, " ")
			.replace(/\(.*?\)|\*/g, " "),
	);
}

/** The season's official games from the school's posted schedule, oldest first. */
export function officialEvents(
	events: SchoolEvent[],
	season: string,
): SchoolEvent[] {
	return events
		.filter(
			(e) =>
				e.date >= `${season}-01-01` &&
				e.date <= `${season}-06-30` &&
				!NOT_OFFICIAL.test(e.opponent) &&
				!!opponentName(e.opponent),
		)
		.sort((a, b) => a.date.localeCompare(b.date));
}

const SCHEDULE_WAIT_MS = 12000;

/** "Loyola Maryland" -> loyola: drop trailing words until a team matches. */
async function opponentId(
	sport: Sport,
	division: Division,
	name: string,
): Promise<string | null> {
	const words = name.split(" ");
	for (let n = words.length; n > 0; n--) {
		const id = await lookupTeam(sport, division, words.slice(0, n).join(" "));
		if (id) return id;
	}
	return null;
}

/**
 * A season's schedule from the school's site, for seasons lax.com hasn't
 * published yet (next season, once the school posts it).
 */
export async function teamSchoolSchedule(
	sport: Sport,
	division: Division,
	teamId: string,
	website: string | null,
	season: string,
): Promise<V1TeamGame[]> {
	const key = scheduleKey(sport, teamId, season);
	let stored = await getBio<StoredSchoolSchedule | null>(key);
	if (scheduleStale(stored)) {
		const job = refreshSchedule(sport, division, teamId, season, website);
		if (!stored) {
			await Promise.race([
				job,
				new Promise((r) => setTimeout(r, SCHEDULE_WAIT_MS)),
			]);
			stored = await getBio<StoredSchoolSchedule | null>(key);
		}
	}
	const events = officialEvents(
		withPostedSchedule(sport, teamId, season, stored?.data?.events ?? []),
		season,
	);
	if (!events.length) return [];
	const { data: teams } = await getTeams(sport, division);
	return Promise.all(
		events.map(async (e) => {
			const name = opponentName(e.opponent);
			const id = await opponentId(sport, division, name);
			const t = id ? teams.find((x) => x.id === id) : undefined;
			return {
				date: e.date,
				time: e.time,
				opponent: {
					id: t?.id ?? null,
					name: t?.name ?? name,
					seoName: t?.seoName ?? null,
					rank: null,
				},
				home: e.at !== "A",
				neutral: e.at === "N",
				venue: e.venue,
				tv: e.tv,
				final: false,
				score: null,
				result: null,
				playoff: null,
			};
		}),
	);
}
