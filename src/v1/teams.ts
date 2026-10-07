import { TieredCache } from "../cache";
import {
	getLaxSeason,
	listBoardTeams,
	listGames,
	type StoredTeamIdentity,
	upsertLaxSeason,
} from "../store";
import { upstreamJson } from "../upstream";
import { formatHometown } from "./hometown";
import { getRosterBio, matchBio, type StoredRosterBio } from "./rosterbio";
import type { Served } from "./service";
import type { V1Game } from "./types";

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
	/** NCAA seoName when we could match it (drives /logo), else null */
	seoName: string | null;
	conference: string | null;
	rank: number | null;
	wins: number;
	losses: number;
}

export interface V1TeamGame {
	date: string;
	/** "01:00 PM" local as published, null when unknown */
	time: string | null;
	opponent: {
		id: string | null;
		name: string;
		seoName: string | null;
		rank: number | null;
	};
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
	/** `6'1"` from the school's athletics site, null when unpublished */
	height: string | null;
	/** pounds, null when unpublished */
	weight: number | null;
	highSchool: string | null;
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
	seoName: string | null;
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
	/** "school" = scraped from the athletics site (current roster), "lax" = lax.com */
	rosterSource: "school" | "lax";
	/** roster year when it comes from the school site and differs from `season` */
	rosterSeason: string | null;
	/** where this season page came from and whether its results matched our NCAA games */
	provenance: TeamProvenance | null;
}

export interface TeamProvenance {
	source: "lax.com" | "cln-store";
	/** results agreed with every stored NCAA final we could line up */
	verified: boolean;
	checked: number;
	disagreed: number;
	fetchedAt: string;
}

export interface ScheduleVerification {
	/** finals we could line up with a stored NCAA game */
	checked: number;
	agreed: number;
	disagreed: {
		date: string;
		opponent: string;
		lax: { us: number; them: number };
		ncaa: { us: number; them: number };
	}[];
	/** finals with no stored NCAA game that day (NCAA never listed it, or name mismatch) */
	unmatched: number;
	verified: boolean;
}

interface LaxSeasonSnapshot {
	team: V1TeamDetail;
	fetchedAt: string;
	verification: ScheduleVerification;
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

const ACRONYMS: Record<string, string> = {
	njit: "NJIT",
	umbc: "UMBC",
	umass: "UMass",
	liu: "LIU",
	vmi: "VMI",
	iupui: "IUPUI",
	suny: "SUNY",
	rpi: "RPI",
	mit: "MIT",
	rit: "RIT",
	wpi: "WPI",
	tcnj: "TCNJ",
	ncaa: "NCAA",
	uc: "UC",
	usc: "USC",
	ucla: "UCLA",
	unc: "UNC",
	smu: "SMU",
	byu: "BYU",
	nyu: "NYU",
	cuny: "CUNY",
	upenn: "UPenn",
	lsu: "LSU",
	uconn: "UConn",
	umd: "UMD",
	unh: "UNH",
	uri: "URI",
	uva: "UVA",
	usf: "USF",
	fdu: "FDU",
	pfw: "PFW",
	depaul: "DePaul",
	desales: "DeSales",
	lemoyne: "Le Moyne",
	mcdaniel: "McDaniel",
	mckendree: "McKendree",
	mcmurry: "McMurry",
};

const POSITION_WORDS =
	/^(a|m|d|g|lsm|ssdm|fo|fogo|f|c|attack|attackman|midfield|midfielder|midi|middie|defense|defence|defenseman|defender|goalie|goalkeeper|goaltender|face-?off|faceoffs?|close|long-?stick|long-?pole|short-?stick|specialist|utility|dm|om|sm|ld|ls|fs|off|def)$/i;

/**
 * Clean lax.com player names for older seasons, which sometimes carry the
 * position in the name ("austin blumbergs a /", "brandon ramirez face-off",
 * "will whitney defense/long-stick") or are stored "Last, First".
 */
export function playerName(raw: string): string {
	let name = raw.replace(/\s+/g, " ").trim();
	const comma = name.match(/^([^,]+),\s*(.+)$/);
	if (comma) name = `${comma[2]} ${comma[1]}`.trim();
	const words = name.split(" ");
	while (words.length > 2) {
		const last = words[words.length - 1];
		if (
			last === "/" ||
			last.split("/").every((part) => part === "" || POSITION_WORDS.test(part))
		) {
			words.pop();
			continue;
		}
		break;
	}
	return words.join(" ");
}

/** Title-case lax.com's lowercase school names ("johns hopkins" -> "Johns Hopkins"). */
export function titleCase(name: string): string {
	return name
		.split(/(\s+|-|\()/)
		.map((w) => ACRONYMS[w.toLowerCase()] ?? w)
		.join("")
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

interface IndexedTeam {
	id: string;
	idKeys: string[];
	nameKeys: string[];
}

function indexTeams(teams: { id: string; name: string }[]): IndexedTeam[] {
	return teams.map((t) => ({
		id: t.id,
		idKeys: matchKeys(t.id),
		nameKeys: matchKeys(t.name),
	}));
}

function resolve(indexed: IndexedTeam[], idOrName: string): string | null {
	const exact = indexed.find((t) => t.id === idOrName);
	if (exact) return exact.id;
	const alias = ALIASES[idOrName.toLowerCase()];
	const candidates = alias ? [alias, idOrName].flat() : [idOrName];
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

/**
 * lax.com id -> NCAA seoName for a board, from the teams we have seen in stored
 * games this season. Lets the app show NCAA logos for lax.com-sourced teams.
 */
async function seoNamesFor(
	sport: Sport,
	division: Division,
	indexed: IndexedTeam[],
	season: string,
): Promise<Map<string, string>> {
	const out = new Map<string, string>();
	let ncaa: StoredTeamIdentity[] = [];
	for (const s of [season, String(Number(season) - 1)]) {
		ncaa = await listBoardTeams(sport, division, s);
		if (ncaa.length) break;
	}
	for (const t of ncaa) {
		const id = resolve(indexed, t.seoName) ?? resolve(indexed, t.shortName);
		if (id && !out.has(id)) out.set(id, t.seoName);
	}
	return out;
}

/**
 * lax.com id (gender suffix stripped) → NCAA seoName for teams that never show
 * up in stored NCAA games (or whose names differ too much to match), so they
 * still get a crest via /logo. Every seoName here was verified against
 * ncaa.com's logo library.
 */
const SEO_FALLBACK: Record<string, string> = {
	"adams-state": "adams-st",
	albion: "albion",
	"alderson-broaddus": "alderson-broaddus",
	aldersonbroaddus: "alderson-broaddus",
	allegheny: "allegheny",
	alliance: "nyack",
	"american-international": "american-intl",
	anderson: "anderson-in",
	asbury: "asbury",
	averett: "averett",
	bard: "bard",
	becker: "becker",
	beloit: "beloit",
	benedictine: "benedictine-il",
	"birmingham-southern": "birmingham-so",
	birminghamsouthern: "birmingham-so",
	boston: "boston-u",
	"bryn-athyn": "bryn-athyn",
	cabrini: "cabrini",
	cairn: "cairn",
	"carroll-wisc": "carroll-wi",
	cazenovia: "cazenovia",
	centenary: "centenary-nj",
	centralmichigan: "central-mich",
	chowan: "chowan",
	"christopher-newport": "chris-newport",
	"coast-guard": "coast-guard",
	"college-of-new-jersey": "tcnj",
	"colorado-college": "colorado",
	"concordia-chicago": "concordia-chicago",
	"concordia-wi": "concordia-wi",
	"connecticut-college": "connecticut-col",
	"cornell-college": "cornell-college",
	"csu-pueblo": "colorado-st-pueblo",
	curry: "curry",
	dallas: "dallas",
	earlham: "earlham",
	"eastern-mennonite": "east-mennonite",
	"eastern-michigan": "eastern-mich",
	"eastern-nazarene": "eastern-nazarene",
	elms: "elms",
	erskine: "erskine",
	ferrum: "ferrum",
	fit: "florida-tech",
	"florida-southern": "fla-southern",
	fontbonne: "fontbonne",
	franciscan: "franciscan",
	franklin: "franklin",
	fresnostate: "fresno-st",
	geneseo: "suny-geneseo",
	"green-mountain": "green-mountain",
	hamline: "hamline",
	heidelberg: "heidelberg",
	hendrix: "hendrix",
	hollins: "hollins",
	houghton: "houghton",
	huntingdon: "huntingdon",
	husson: "husson",
	"illinois-wesleyan": "ill-wesleyan",
	"johnson--wales-providence": "johnson-wales-ri",
	"johnson-and-wales": "johnson-wales-ri",
	"johnson-state": "johnson-st",
	"jwu-denver": "johnson-wales-co",
	keystone: "keystone",
	"la-roche": "la-roche",
	"lancaster-bible": "lancaster-bible",
	limestone: "limestone",
	lindenwood: "lindenwood",
	"liu-post": "liu-post",
	"lyndon-state": "lyndon-st",
	mainefarmington: "me-farmington",
	manhattanville: "manhattanville",
	"maritime-college": "suny-maritime",
	"mary-washington": "mary-washington",
	"massachusetts-cla": "mcla",
	mcla: "mcla",
	medaille: "medaille",
	michigan: "michigan",
	"monmouth-il": "monmouth-il",
	"monmouth-illinois": "monmouth-il",
	"mount-ida": "mount-ida",
	"mount-st-joseph": "mt-st-joseph",
	"new-england-college": "new-england-col",
	"new-paltz": "suny-new-paltz",
	newbury: "newbury",
	"north-central": "north-central-il",
	"north-central-univ.-(mn)": "north-central-mn",
	"northern-michigan": "northern-mich",
	northland: "northland",
	"northwestern-mn": "northwestern-st-paul",
	"northwestern-st-paul": "northwestern-st-paul",
	"notre-dame-de-namur": "notre-dame-de-namur",
	"notre-dame-md": "notre-dame-md",
	"notre-dame-oh": "notre-dame-oh",
	notredamemd: "notre-dame-md",
	nvulyndon: "lyndon-st",
	nyack: "nyack",
	nyit: "nyit",
	"ohio-valley": "ohio-valley",
	olivet: "olivet",
	oneonta: "oneonta-st",
	oswego: "oswego-st",
	"palm-beach-atlantic": "palm-beach-atl",
	palmbeachatlantic: "palm-beach-atl",
	"penn-stateabington": "penn-st-abington",
	"plattsburg-state": "plattsburgh-st",
	"rhode-island-college": "rhode-island",
	rhodes: "rhodes",
	rosemont: "rosemont",
	rutgerscamden: "rutgers-camden",
	"saint-rose": "saint-rose",
	saintfrancis: "st-francis-pa",
	simmons: "simmons",
	"southern-maine": "southern-me",
	"southern-virginia": "southern-va",
	southflorida: "south-fla",
	southwestern: "southwestern-tx",
	"st-marys-md": "st-marys-md",
	stonybrook: "stony-brook",
	"suny-cobleskill": "cobleskill-st",
	swarthmore: "swarthmore",
	"trinity-dc": "trinity-washington",
	"umass-dartmouth": "umass-dartmouth",
	"univ-of-dc": "dist-columbia",
	"univ-of-new-england": "u-new-england",
	"university-of-dallas": "dallas",
	"university-of-new-england": "u-new-england",
	"upper-iowa": "upper-iowa",
	"uw-stout": "wis-stout",
	uwstevenspoint: "wis-stevens-point",
	wartburg: "wartburg",
	"washington--jefferson": "wash-jeff",
	"washington--lee": "wash-lee",
	"washington-and-jefferson": "wash-jeff",
	"washington-and-lee": "wash-lee",
	"washington-college": "washington",
	waynesburg: "waynesburg",
	wells: "wells",
	wesley: "wesley",
	"west-virginia-wesleyan": "west-va-wesleyan",
	"western-new-england": "western-new-eng",
	whittier: "whittier",
	"william-smith": "william-smith",
	"wisconsin-eau-claire": "wis-eau-claire",
	wooster: "wooster",
};

const stripGender = (id: string) => id.replace(/-?(w|m|womens|women)$/, "");

export function getTeams(
	sport: Sport,
	division: Division,
): Promise<Served<V1TeamSummary[]>> {
	const div = laxDivision(sport, division);
	return cached(`teams:${div}`, async () => {
		const raw = await laxJson<LaxTeam[]>({ action: "getTeams", division: div });
		const teams = raw
			.filter((t) => t?.url_name)
			.map((t) => ({
				id: t.url_name,
				name: titleCase(t.label || t.name || t.url_name),
				seoName: null as string | null,
				conference: t.conference?.[0]?.label ?? null,
				rank: rankOf(t.rank),
				wins: num(t.wins),
				losses: num(t.losses),
			}))
			.sort((a, b) => a.name.localeCompare(b.name));
		const seo = await seoNamesFor(
			sport,
			division,
			indexTeams(teams),
			defaultTeamSeason(),
		);
		for (const t of teams)
			t.seoName = seo.get(t.id) ?? SEO_FALLBACK[stripGender(t.id)] ?? null;
		return teams;
	});
}

/** Resolve a lax url_name, NCAA seoName or display name to a team id. */
export async function lookupTeam(
	sport: Sport,
	division: Division,
	idOrName: string,
): Promise<string | null> {
	const { data: teams } = await getTeams(sport, division);
	return resolve(indexTeams(teams), idOrName);
}

const EMPTY_STATS: V1RosterPlayer["stats"] = {
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
};

const CLASS_YEARS: Record<string, string> = {
	freshman: "Fr",
	sophomore: "So",
	junior: "Jr",
	senior: "Sr",
	graduate: "Gr",
	"graduate student": "Gr",
	"redshirt freshman": "R-Fr",
	"redshirt sophomore": "R-So",
	"redshirt junior": "R-Jr",
	"redshirt senior": "R-Sr",
	"1st year": "Fr",
	"2nd year": "So",
	"3rd year": "Jr",
	"4th year": "Sr",
	"5th year": "Gr",
};

const classYear = (y: string | null) => {
	if (!y) return null;
	const long = CLASS_YEARS[y.trim().toLowerCase()];
	if (long) return long;
	return y.replace(/\.$/, "").replace(/^(\w)/, (c) => c.toUpperCase());
};

const POSITION_CODES: Record<string, string> = {
	attack: "A",
	attackman: "A",
	attacker: "A",
	att: "A",
	midfield: "M",
	midfielder: "M",
	mid: "M",
	midi: "M",
	middie: "M",
	defense: "D",
	defence: "D",
	defenseman: "D",
	defender: "D",
	def: "D",
	goalie: "G",
	goalkeeper: "G",
	goaltender: "G",
	gk: "G",
	faceoff: "FO",
	"face-off": "FO",
	fogo: "FO",
	"faceoff specialist": "FO",
	"face-off specialist": "FO",
	"long stick midfielder": "LSM",
	"long-stick midfielder": "LSM",
	"longstick midfielder": "LSM",
	"long stick midfield": "LSM",
	"long-stick midfield": "LSM",
	"longstick midfield": "LSM",
	"long stick": "LSM",
	"long-stick": "LSM",
	longstick: "LSM",
	"defensive midfielder": "SSDM",
	"defensive midfield": "SSDM",
	"short stick defensive midfielder": "SSDM",
	"short-stick defensive midfielder": "SSDM",
	"short stick defensive midfield": "SSDM",
	"short-stick defensive midfield": "SSDM",
};

/** School sites spell positions out ("Attackman/Midfielder"); shorten to A/M. */
export function positionCode(raw: string | null | undefined): string | null {
	if (!raw) return null;
	const code = raw
		.split("/")
		.map((part) => part.trim().toLowerCase().replace(/\s+/g, " "))
		.filter(Boolean)
		.map((part) => POSITION_CODES[part] ?? part.toUpperCase())
		.join("/");
	return code || null;
}

/**
 * Current-season roster straight from the school's site (the source of truth
 * as new rosters are posted), with each player's lax.com line matched in by
 * number/name for stats and ids. Returners keep their stats; newcomers get 0s.
 */
function schoolRoster(
	bio: StoredRosterBio,
	lax: V1RosterPlayer[],
): V1RosterPlayer[] {
	return bio.players
		.map((sp, i) => {
			const lp = sameNamePlayer(lax, sp);
			return {
				id: lp?.id ?? `school-${sp.number ?? i}-${sp.name}`,
				number: sp.number,
				name: sp.name,
				position: positionCode(sp.position) ?? lp?.position ?? null,
				year: classYear(sp.year) ?? lp?.year ?? null,
				hometown: formatHometown(sp.hometown ?? lp?.hometown),
				height: sp.height,
				weight: sp.weight,
				highSchool: sp.highSchool,
				stats: lp?.stats ?? EMPTY_STATS,
			};
		})
		.sort(
			(a, b) => num(a.number) - num(b.number) || a.name.localeCompare(b.name),
		);
}

/**
 * The lax.com line for a school-roster player: same last name and first
 * initial (rosters roll over between seasons, so a jersey number alone must
 * never match), jersey number breaking ties between siblings/namesakes.
 */
function sameNamePlayer(
	lax: V1RosterPlayer[],
	sp: { number: string | null; name: string },
): V1RosterPlayer | undefined {
	const key = nameKey(sp.name);
	if (!key) return undefined;
	const byName = lax.filter((p) => nameKey(p.name) === key);
	if (byName.length === 1) return byName[0];
	if (!byName.length || !sp.number) return undefined;
	const n = String(Number(sp.number));
	const byNumber = byName.filter(
		(p) => p.number && String(Number(p.number)) === n,
	);
	return byNumber.length === 1 ? byNumber[0] : undefined;
}

/** "José Núñez Jr." -> "j|nunez" */
function nameKey(name: string): string | null {
	const parts = name
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-z ]/g, "")
		.split(" ")
		.filter((w) => w && !/^(jr|sr|ii|iii|iv)$/.test(w));
	if (parts.length < 2) return null;
	return `${parts[0][0]}|${parts[parts.length - 1]}`;
}

/**
 * Compare a lax.com season schedule with the NCAA games we store for those
 * days. A season is verified only when every final we can line up agrees;
 * games NCAA never listed are counted but don't block verification.
 */
export function verifySchedule(
	schedule: V1TeamGame[],
	seoName: string | null,
	gamesByDate: Map<string, V1Game[]>,
): ScheduleVerification {
	const out: ScheduleVerification = {
		checked: 0,
		agreed: 0,
		disagreed: [],
		unmatched: 0,
		verified: false,
	};
	if (!seoName) return out;
	for (const g of schedule) {
		if (!g.final || !g.score) continue;
		const match = findNcaaGame(g, seoName, gamesByDate);
		if (!match) {
			out.unmatched++;
			continue;
		}
		const us = match.home.seoName === seoName ? match.home : match.away;
		const them = us === match.home ? match.away : match.home;
		if (us.score === null || them.score === null) continue;
		if (us.score === 0 && them.score === 0) continue;
		out.checked++;
		if (us.score === g.score.us && them.score === g.score.them) out.agreed++;
		else
			out.disagreed.push({
				date: g.date,
				opponent: g.opponent.name,
				lax: g.score,
				ncaa: { us: us.score, them: them.score },
			});
	}
	out.verified = out.checked > 0 && out.disagreed.length === 0;
	return out;
}

/**
 * lax.com dates can sit a day off NCAA's (older seasons were entered in a
 * different timezone), so when the opponent is known we also look at the
 * neighbouring days and require the opponent to match.
 */
function findNcaaGame(
	g: V1TeamGame,
	seoName: string,
	gamesByDate: Map<string, V1Game[]>,
): V1Game | undefined {
	const opp = g.opponent.seoName;
	const sameDay = (gamesByDate.get(g.date) ?? []).find((x) =>
		opp
			? (x.home.seoName === seoName && x.away.seoName === opp) ||
				(x.away.seoName === seoName && x.home.seoName === opp)
			: x.home.seoName === seoName || x.away.seoName === seoName,
	);
	if (sameDay || !opp) return sameDay;
	for (const date of adjacentDates(g.date))
		for (const x of gamesByDate.get(date) ?? [])
			if (
				(x.home.seoName === seoName && x.away.seoName === opp) ||
				(x.away.seoName === seoName && x.home.seoName === opp)
			)
				return x;
	return undefined;
}

export function adjacentDates(date: string): string[] {
	const d = new Date(`${date}T12:00:00Z`);
	return [-1, 1].map((off) => {
		const n = new Date(d);
		n.setUTCDate(d.getUTCDate() + off);
		return n.toISOString().slice(0, 10);
	});
}

const snapshotKey = (
	sport: Sport,
	division: Division,
	id: string,
	season: string,
) => `${laxDivision(sport, division)}:${id}:${season}`;

async function verifyAgainstStore(
	team: V1TeamDetail,
): Promise<ScheduleVerification> {
	const dates = [
		...new Set(
			team.schedule
				.filter((g) => g.final && g.score)
				.flatMap((g) => [g.date, ...adjacentDates(g.date)]),
		),
	];
	const byDate = new Map<string, V1Game[]>();
	for (const date of dates) {
		const rows = await listGames(team.sport, team.division, date);
		byDate.set(
			date,
			rows.map((r) => r.game),
		);
	}
	return verifySchedule(team.schedule, team.seoName, byDate);
}

export async function getTeam(
	sport: Sport,
	division: Division,
	id: string,
	season = defaultTeamSeason(),
): Promise<Served<V1TeamDetail | null>> {
	const served =
		season < defaultTeamSeason()
			? await getPastTeam(sport, division, id, season)
			: await getTeamRaw(sport, division, id, season);
	const team = served.data;
	if (!team) return served;
	const bio = await getRosterBio(sport, id, team.website);
	if (!bio?.players.length) return served;
	if (season === defaultTeamSeason()) {
		return {
			...served,
			data: {
				...team,
				roster: schoolRoster(bio, team.roster),
				rosterSource: "school",
				rosterSeason: bio.season && bio.season !== season ? bio.season : null,
			},
		};
	}
	const seasonBio = await getRosterBio(sport, id, team.website, season);
	return {
		...served,
		data: {
			...team,
			roster: team.roster.map((p) => {
				const b = matchBio(seasonBio, p) ?? matchBio(bio, p);
				return b
					? {
							...p,
							height: b.height,
							weight: b.weight,
							highSchool: b.highSchool,
							hometown: formatHometown(p.hometown ?? b.hometown),
						}
					: { ...p, hometown: formatHometown(p.hometown) };
			}),
		},
	};
}

/**
 * Past seasons: serve our own verified copy when we have one; otherwise fetch
 * lax.com, check its results against our stored NCAA games and keep the copy
 * (verified or not) so history survives if lax.com goes away. An unverified
 * copy is only served when lax.com itself is unreachable.
 */
async function getPastTeam(
	sport: Sport,
	division: Division,
	id: string,
	season: string,
): Promise<Served<V1TeamDetail | null>> {
	const key = snapshotKey(sport, division, id, season);
	const stored = await getLaxSeason<LaxSeasonSnapshot>(key);
	const fromStore = (snap: LaxSeasonSnapshot, updatedAt: string) => ({
		data: {
			...snap.team,
			provenance: {
				source: "cln-store" as const,
				verified: snap.verification.verified,
				checked: snap.verification.checked,
				disagreed: snap.verification.disagreed.length,
				fetchedAt: snap.fetchedAt,
			},
		},
		updatedAt,
		stale: false,
	});
	if (stored?.data.verification.verified)
		return fromStore(stored.data, stored.updatedAt);
	let served: Served<V1TeamDetail | null>;
	try {
		served = await getTeamRaw(sport, division, id, season);
	} catch (err) {
		if (stored) return fromStore(stored.data, stored.updatedAt);
		throw err;
	}
	const team = served.data;
	if (!team || served.stale) return served;
	const verification = await verifyAgainstStore(team);
	const fetchedAt = new Date().toISOString();
	await upsertLaxSeason(key, {
		team,
		fetchedAt,
		verification,
	} satisfies LaxSeasonSnapshot);
	return {
		...served,
		data: {
			...team,
			provenance: {
				source: "lax.com",
				verified: verification.verified,
				checked: verification.checked,
				disagreed: verification.disagreed.length,
				fetchedAt,
			},
		},
	};
}

function getTeamRaw(
	sport: Sport,
	division: Division,
	id: string,
	season: string,
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
			const { data: teams } = await getTeams(sport, division);
			const seoOf = (laxId: string | undefined) =>
				(laxId && teams.find((x) => x.id === laxId)?.seoName) ?? null;
			const seoName = teams.find((x) => x.id === id)?.seoName ?? null;
			return {
				id,
				name: titleCase(t.name),
				seoName,
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
				rosterSource: "lax",
				rosterSeason: null,
				provenance: null,
				seasons: t.years ?? [],
				schedule: (raw?.schedule ?? []).map((g) => {
					const final = String(g.is_final) === "1";
					return {
						date: g.date,
						time: g.time || null,
						opponent: {
							id: g.opponent_url_name || null,
							name: titleCase(g.opponent_name || "TBA"),
							seoName: seoOf(g.opponent_url_name),
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
						name: playerName(p.name),
						position: p.position ? p.position.toUpperCase() : null,
						year: p.year
							? p.year.charAt(0).toUpperCase() + p.year.slice(1)
							: null,
						hometown: formatHometown(
							[p.town, p.state].filter(Boolean).join(", "),
						),
						height: null,
						weight: null,
						highSchool: null,
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
