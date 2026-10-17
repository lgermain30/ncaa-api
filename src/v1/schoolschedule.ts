import * as cheerio from "cheerio";
import { TieredCache } from "../cache";
import { getBio, upsertBio } from "../store";
import { upstreamFetch } from "../upstream";
import { hostOf, PATHS, resolveHost } from "./rosterbio";
import { type Division, getTeam, lookupTeam, type Sport } from "./teams";
import type { V1Game, V1Team } from "./types";

/*
 * TV, start time and venue from each school's own schedule page
 * (/sports/<code>/schedule/<season>). NCAA only publishes these for
 * tournament games. Two Sidearm flavours are read:
 *   nuxt     schedule event objects inside the `__NUXT_DATA__` devalue array
 *   classic  server-rendered `.sidearm-schedule-game` rows
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
	source: "sidearm_nuxt" | "sidearm_classic";
	season: string;
	events: SchoolEvent[];
}

export const SCHEDULE_REFRESH_MS = 6 * 60 * 60 * 1000;
export const SCHEDULE_MISS_REFRESH_MS = 24 * 60 * 60 * 1000;

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
		events.push({
			date: `${season}-${String(month + 1).padStart(2, "0")}-${dm[2].padStart(2, "0")}`,
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
): Promise<void> {
	const key = scheduleKey(sport, teamId, season);
	const running = inflight.get(key);
	if (running) return running;
	const job = withSlot(async () => {
		const { data: team } = await getTeam(sport, division, teamId, season);
		const host = hostOf(team?.website ?? null);
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
	const age = stored
		? Date.now() - new Date(stored.updatedAt).getTime()
		: Infinity;
	if (age > (stored?.data ? SCHEDULE_REFRESH_MS : SCHEDULE_MISS_REFRESH_MS))
		void refreshSchedule(sport, division, teamId, season).catch(() => {});
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
