import { TieredCache } from "../cache";
import { upstreamJson } from "../upstream";
import type { Served } from "./service";

/*
 * Team directory, season schedule/results and rosters. NCAA publishes none of
 * these for lacrosse, so they come from lax.com's public stats API (the same
 * source the CLN WordPress plugin uses for rosters). Teams are addressed by
 * lax.com's url_name, but `lookupTeam` also accepts an NCAA seoName or display
 * name so a game row can link straight to the team page.
 */

export type Sport = "lacrosse-men" | "lacrosse-women";
export type Division = "d1" | "d2" | "d3";

const LAX_API = "https://www.laxshop.com/shopify_stats.php";
const cache = new TieredCache("lax-teams", 30 * 60 * 1000);

export interface V1TeamSummary {
	/** lax.com url_name, the id used by /v1/teams/.../:id */
	id: string;
	name: string;
	conference: string | null;
	rank: number | null;
	wins: number;
	losses: number;
}

export interface V1TeamGame {
	date: string;
	/** "01:00 PM" local as published, null when unknown */
	time: string | null;
	opponent: { id: string | null; name: string; rank: number | null };
	/** true = we hosted, false = away; neutral sites are reported as home by the source */
	home: boolean;
	final: boolean;
	score: { us: number; them: number } | null;
	result: "W" | "L" | "T" | null;
	playoff: string | null;
}

export interface V1RosterPlayer {
	id: string;
	number: string | null;
	name: string;
	position: string | null;
	year: string | null;
	hometown: string | null;
	stats: {
		goals: number;
		assists: number;
		shots: number;
		groundBalls: number;
		turnovers: number;
		causedTurnovers: number;
		faceoffsWon: number;
		faceoffsTaken: number;
		saves: number;
		shotsFaced: number;
	};
}

export interface V1TeamDetail {
	id: string;
	name: string;
	sport: Sport;
	division: Division;
	season: string;
	coach: string | null;
	conference: string | null;
	rank: number | null;
	overall: { wins: number; losses: number };
	conferenceRecord: { wins: number; losses: number } | null;
	website: string | null;
	seasons: string[];
	schedule: V1TeamGame[];
	roster: V1RosterPlayer[];
}

/* lax.com payload shapes (strings for most numbers) */
interface LaxTeam {
	label?: string;
	name?: string;
	url_name: string;
	wins?: string | number;
	losses?: string | number;
	rank?: string | number;
	conference?: { label: string }[];
}
interface LaxTeamFull {
	team: {
		name: string;
		url_name: string;
		wins?: string | number;
		losses?: string | number;
		coach?: string;
		rank?: string | number;
		conference_name?: string;
		website?: string;
		years?: string[];
	}[];
	conference: {
		teams?: {
			url: string;
			conf_wins?: number | string;
			conf_losses?: number | string;
		}[];
	} | null;
	schedule:
		| {
				date: string;
				time?: string;
				playoff_name?: string;
				is_final?: string | number;
				opponent_name?: string;
				opponent_url_name?: string;
				opponent_rank?: string | number;
				our_goals?: string | number | null;
				opponent_goals?: string | number | null;
				where?: string;
				result?: string;
		  }[]
		| null;
	players:
		| {
				player_id: string;
				number?: string;
				name: string;
				position?: string;
				year?: string;
				town?: string;
				state?: string;
				goals?: string | number;
				assists?: string | number;
				shots?: string | number;
				ground_balls?: string | number;
				turnovers?: string | number;
				caused_turnovers?: string | number;
				faceoffs_won?: string | number;
				faceoffs_taken?: string | number;
				saves?: string | number;
				shots_faced?: string | number;
		  }[]
		| null;
}

export function laxDivision(sport: Sport, division: Division): number {
	const n = Number(division.slice(1));
	return sport === "lacrosse-women" ? n + 3 : n;
}

export function defaultTeamSeason(now = new Date()): string {
	return String(now.getFullYear());
}

const num = (v: unknown): number => {
	const n = Number(v);
	return Number.isFinite(n) ? n : 0;
};
const rankOf = (v: unknown): number | null => {
	const n = Number(v);
	return Number.isFinite(n) && n > 0 ? n : null;
};

/** Title-case lax.com's lowercase school names ("johns hopkins" -> "Johns Hopkins"). */
export function titleCase(name: string): string {
	return name
		.split(/(\s+|-|\()/)
		.map((w) =>
			/^[a-z]/.test(w)
				? w.length <= 3 && w === w.toUpperCase()
					? w
					: w.charAt(0).toUpperCase() + w.slice(1)
				: w,
		)
		.join("")
		.replace(/\bSt\b\.?/g, "St.")
		.replace(/\((\w)/g, (_, c: string) => `(${c.toUpperCase()}`);
}

const STATE_SUFFIX =
	/\b(ny|nj|md|ga|fl|ma|wi|nc|pa|ct|ca|dc|mo|in|il|tx|va|oh|mn|wp|women|w|m)$/;

/**
 * Match keys for an NCAA team name/seoName or lax.com id. NCAA and lax.com
 * abbreviate differently ("st-johns-ny" vs "saint-johns", "loyola-maryland" vs
 * "loyola"), so each name yields a few progressively looser keys and two teams
 * match when they share any key. Keys are ordered strict → loose.
 */
export function matchKeys(s: string): string[] {
	let base = s
		.toLowerCase()
		.replace(/\(.*?\)/g, " ")
		.replace(/&/g, " and ")
		.replace(/[_.'’]/g, "")
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
	base = base.replace(STATE_SUFFIX, "").trim();
	base = base
		.replace(/\bsaint\b/g, "st")
		.replace(/\bmount\b/g, "mt")
		.replace(/\bstate university of new york( at)?\b/g, "suny")
		.replace(/\bstate university of new york\b/g, "suny")
		.replace(/\binstitute of technology\b|\btech\b/g, "tech")
		.replace(/\buniv\b/g, "university")
		.replace(/\bthe\b|\bof\b|\bat\b|\bin\b/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	const keys: string[] = [];
	const push = (k: string) => {
		const key = k.replace(/[^a-z0-9]/g, "");
		if (key && !keys.includes(key)) keys.push(key);
	};
	push(base);
	push(base.replace(/\bstate\b/g, "st"));
	push(base.replace(/\bst\b/g, "state"));
	push(base.replace(/\bcollege\b|\buniversity\b/g, ""));
	return keys;
}

/** Hand overrides where the names simply differ (NCAA seoName → lax id). */
const ALIASES: Record<string, string | string[]> = {
	"loyola-maryland": "loyola",
	"army-west-point": ["army", "armywp"],
	army: ["army", "armywp"],
	"albany-ny": "albany",
	"st-johns-ny": "saint-johns",
	"mt-st-marys": "mount-saint-marys",
	"queens-nc": "queens",
	charlotte: "unccharlotte",
	fdu: "fairleigh-dickinson",
	"st-bonaventure": "st-bonaventure",
	"southern-nh": ["southern-new-hampshire", "so-new-hampshire"],
	"rochester-inst": "rit",
	rensselaer: "rpi",
	"adams-st": "adams-state",
	"suny-potsdam": ["potsdam-state", "potsdam"],
	"eastern-conn-st": "eastern-connecticut",
	"st-josephs-li": ["st.-joseph's-college-ny", "st-josephs-ny"],
	"dominican-ca": "dominicanca",
	"wis-river-falls": "uwriver-falls",
	"wis-la-crosse": "uwlacrosse",
	"emmanuel-ga": "emmanuel-georgia",
	"embry-riddle-fl": "embryriddle",
	"colorado-mesa": "mesa",
	"ala-huntsville": "alabama-huntsville",
	"dist-columbia": "district-of-columbia",
	"suny-maritime": "new-york-maritime",
	"st-john-fisher": "saint-john-fisher",
	"st-marys-md": "saint-marys-md",
	"penn-tech": "penn_college",
	wentworth: "wentworth-tech",
	stevens: "stevens-tech",
	castleton: "castleton-state",
	"merchant-marine": "us-merchant-marine",
	"farmingdale-st": "farmingdale",
	"western-conn-st": "western-connecticut",
	"southern-conn-st": "southern-connecticut",
	"central-conn-st": "centralconnecticut",
	"concordia-wi": "concordia-wi",
	"va-wesleyan": "virginia-wesleyan",
	"plattsburgh-st": "plattsburgh",
	"mt-st-mary-ny": "mount-st-mary",
	"sage-colleges": "sage",
	sunyit: "suny-poly",
	"morrisville-st": "morrisville",
	"purchase-st": "purchase",
	"st-lawrence": "saint-lawrence",
	"philadelphia-u": "jefferson",
	"dominican-ny": "dominican-college",
	"alfred-st": "alfred-state",
	catholic: "catholic-dc",
	"mt-st-vincent": "mount-saint-vincent",
	msoe: "milwaukee-engineering",
	"claremont-m-s": "claremontmuddscripps",
	"maryville-mo": "maryville",
	penn: "pennsylvania",
	indianapolis: "uindy",
	"southern-california": "usc",
	"florida-tech": "florida-tech",
};

async function laxJson<T>(params: Record<string, string | number>): Promise<T> {
	const qs = new URLSearchParams(
		Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
	);
	return upstreamJson<T>(`${LAX_API}?${qs}`, {
		headers: {
			"User-Agent": "Mozilla/5.0",
			Referer: "https://www.lax.com/",
			Accept: "application/json",
		},
	});
}

async function cached<T>(
	key: string,
	load: () => Promise<T>,
): Promise<Served<T>> {
	const fresh = (cache.get(key) ?? (await cache.getShared(key))) as
		| T
		| undefined;
	if (fresh !== undefined)
		return { data: fresh, updatedAt: new Date().toISOString(), stale: false };
	try {
		const data = await load();
		cache.set(key, data);
		return { data, updatedAt: new Date().toISOString(), stale: false };
	} catch (err) {
		const stale = await cache.getStale(key);
		if (!stale) throw err;
		return {
			data: stale.value as T,
			updatedAt: new Date(Date.now() - stale.ageSeconds * 1000).toISOString(),
			stale: true,
		};
	}
}

export function getTeams(
	sport: Sport,
	division: Division,
): Promise<Served<V1TeamSummary[]>> {
	const div = laxDivision(sport, division);
	return cached(`teams:${div}`, async () => {
		const raw = await laxJson<LaxTeam[]>({ action: "getTeams", division: div });
		return raw
			.filter((t) => t?.url_name)
			.map((t) => ({
				id: t.url_name,
				name: titleCase(t.label || t.name || t.url_name),
				conference: t.conference?.[0]?.label ?? null,
				rank: rankOf(t.rank),
				wins: num(t.wins),
				losses: num(t.losses),
			}))
			.sort((a, b) => a.name.localeCompare(b.name));
	});
}

/** Resolve a lax url_name, NCAA seoName or display name to a team id. */
export async function lookupTeam(
	sport: Sport,
	division: Division,
	idOrName: string,
): Promise<string | null> {
	const { data: teams } = await getTeams(sport, division);
	const exact = teams.find((t) => t.id === idOrName);
	if (exact) return exact.id;
	const alias = ALIASES[idOrName.toLowerCase()];
	const candidates = alias ? [alias, idOrName].flat() : [idOrName];
	const indexed = teams.map((t) => ({
		id: t.id,
		idKeys: matchKeys(t.id),
		nameKeys: matchKeys(t.name),
	}));
	for (const candidate of candidates) {
		const byId = indexed.find(
			(t) =>
				t.id === candidate ||
				t.id.replace(/-(w|m|women|womens)$/, "") === candidate,
		);
		if (byId) return byId.id;
		for (const key of matchKeys(candidate)) {
			const hit =
				indexed.find((t) => t.idKeys[0] === key) ??
				indexed.find((t) => t.nameKeys[0] === key) ??
				indexed.find((t) => t.idKeys.includes(key) || t.nameKeys.includes(key));
			if (hit) return hit.id;
		}
	}
	return null;
}

export function getTeam(
	sport: Sport,
	division: Division,
	id: string,
	season = defaultTeamSeason(),
): Promise<Served<V1TeamDetail | null>> {
	return cached(
		`team:${laxDivision(sport, division)}:${id}:${season}`,
		async () => {
			const raw = await laxJson<LaxTeamFull | null>({
				action: "getTeamFull",
				url_name: id,
				year: season,
			});
			const t = raw?.team?.[0];
			if (!t) return null;
			const conf = raw?.conference?.teams?.find((c) => c.url === id);
			return {
				id,
				name: titleCase(t.name),
				sport,
				division,
				season,
				coach: t.coach || null,
				conference: t.conference_name || null,
				rank: rankOf(t.rank),
				overall: { wins: num(t.wins), losses: num(t.losses) },
				conferenceRecord: conf
					? { wins: num(conf.conf_wins), losses: num(conf.conf_losses) }
					: null,
				website: t.website || null,
				seasons: t.years ?? [],
				schedule: (raw?.schedule ?? []).map((g) => {
					const final = String(g.is_final) === "1";
					return {
						date: g.date,
						time: g.time || null,
						opponent: {
							id: g.opponent_url_name || null,
							name: titleCase(g.opponent_name || "TBA"),
							rank: rankOf(g.opponent_rank),
						},
						home: g.where !== "@",
						final,
						score: final
							? { us: num(g.our_goals), them: num(g.opponent_goals) }
							: null,
						result:
							final &&
							(g.result === "W" || g.result === "L" || g.result === "T")
								? g.result
								: null,
						playoff: g.playoff_name || null,
					};
				}),
				roster: (raw?.players ?? [])
					.map((p) => ({
						id: p.player_id,
						number: p.number || null,
						name: p.name,
						position: p.position ? p.position.toUpperCase() : null,
						year: p.year
							? p.year.charAt(0).toUpperCase() + p.year.slice(1)
							: null,
						hometown: [p.town, p.state].filter(Boolean).join(", ") || null,
						stats: {
							goals: num(p.goals),
							assists: num(p.assists),
							shots: num(p.shots),
							groundBalls: num(p.ground_balls),
							turnovers: num(p.turnovers),
							causedTurnovers: num(p.caused_turnovers),
							faceoffsWon: num(p.faceoffs_won),
							faceoffsTaken: num(p.faceoffs_taken),
							saves: num(p.saves),
							shotsFaced: num(p.shots_faced),
						},
					}))
					.sort(
						(a, b) =>
							num(a.number) - num(b.number) || a.name.localeCompare(b.name),
					),
			};
		},
	);
}
