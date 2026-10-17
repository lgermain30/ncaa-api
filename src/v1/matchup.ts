/**
 * Tale of the Tape for a game: each team's record splits and per-game stats
 * entering the game (from our stored NCAA finals + box scores), roster
 * averages (school rosters via getTeam), and the head-to-head series since
 * 2014 (as far back as NCAA results go).
 */
import { TieredCache } from "../cache";
import { listTeamFinals, type StoredTeamFinal } from "../store";
import { getGameById, type Served } from "./service";
import {
	type Division,
	getTeam,
	lookupTeam,
	type Sport,
	type V1RosterPlayer,
} from "./teams";
import type { V1Game, V1Team } from "./types";

export const SERIES_SINCE = "2014";

export interface V1Record {
	wins: number;
	losses: number;
	ties: number;
}

export interface V1MatchupStats {
	/** finals counted for goals for/against */
	games: number;
	/** finals whose box score we hold (denominator for everything else) */
	boxGames: number;
	goalsFor: number;
	goalsAgainst: number;
	shots: number;
	shotsOnGoal: number;
	groundBalls: number;
	turnovers: number;
	causedTurnovers: number;
	saves: number;
	faceoffsWon: number;
	faceoffsLost: number;
	drawControls: number;
	clears: number;
	clearAttempts: number;
	extraManGoals: number;
	extraManOpportunities: number;
	penalties: number;
	penaltyMinutes: number;
}

export interface V1MatchupRoster {
	players: number;
	avgHeightIn: number | null;
	avgWeight: number | null;
	/** counts by class: Fr / So / Jr / Sr / Gr */
	classes: Record<string, number>;
}

export interface V1MatchupTeam {
	seoName: string | null;
	name: string;
	records: {
		overall: V1Record;
		conference: V1Record;
		home: V1Record;
		away: V1Record;
		overtime: V1Record;
		lastTen: V1Record;
		/** e.g. "W3" */
		streak: string | null;
	};
	stats: V1MatchupStats;
	roster: V1MatchupRoster | null;
}

export interface V1SeriesGame {
	gameId: string;
	date: string;
	homeSeoName: string | null;
	homeScore: number;
	awayScore: number;
	/** seoName of the winner; null for a tie */
	winner: string | null;
}

export interface V1Series {
	since: string;
	/** wins for this game's away / home team */
	awayWins: number;
	homeWins: number;
	ties: number;
	/** newest first */
	games: V1SeriesGame[];
}

export interface V1Matchup {
	gameId: string;
	season: string;
	/** records and stats count finals before this date */
	before: string;
	away: V1MatchupTeam;
	home: V1MatchupTeam;
	thisSeason: V1Series;
	allTime: V1Series;
}

const cache = new TieredCache("matchup", 30 * 60 * 1000);

const rec = (): V1Record => ({ wins: 0, losses: 0, ties: 0 });
const add = (r: V1Record, res: "W" | "L" | "T") => {
	if (res === "W") r.wins++;
	else if (res === "L") r.losses++;
	else r.ties++;
};

function sides(game: V1Game, seoName: string) {
	const home = game.home.seoName === seoName;
	return home
		? { us: game.home, them: game.away, home }
		: { us: game.away, them: game.home, home };
}

function result(us: V1Team, them: V1Team): "W" | "L" | "T" | null {
	if (us.score === null || them.score === null) return null;
	return us.score > them.score ? "W" : us.score < them.score ? "L" : "T";
}

/** Record splits and summed stats for a team over its finals before `before`. */
export function summarizeTeam(
	team: V1Team,
	finals: StoredTeamFinal[],
	before: string,
): Pick<V1MatchupTeam, "records" | "stats"> {
	const records = {
		overall: rec(),
		conference: rec(),
		home: rec(),
		away: rec(),
		overtime: rec(),
		lastTen: rec(),
		streak: null as string | null,
	};
	const stats: V1MatchupStats = {
		games: 0,
		boxGames: 0,
		goalsFor: 0,
		goalsAgainst: 0,
		shots: 0,
		shotsOnGoal: 0,
		groundBalls: 0,
		turnovers: 0,
		causedTurnovers: 0,
		saves: 0,
		faceoffsWon: 0,
		faceoffsLost: 0,
		drawControls: 0,
		clears: 0,
		clearAttempts: 0,
		extraManGoals: 0,
		extraManOpportunities: 0,
		penalties: 0,
		penaltyMinutes: 0,
	};
	const seo = team.seoName;
	if (!seo) return { records, stats };
	const results: ("W" | "L" | "T")[] = [];
	const games = finals
		.filter(({ game }) => game.date < before)
		.sort((a, b) => a.game.date.localeCompare(b.game.date));
	for (const { game, teamStats } of games) {
		const { us, them, home } = sides(game, seo);
		const res = result(us, them);
		if (!res) continue;
		results.push(res);
		add(records.overall, res);
		add(home ? records.home : records.away, res);
		if (game.linescore.length > 4) add(records.overtime, res);
		if (!game.bracket && us.conference && us.conference === them.conference)
			add(records.conference, res);
		stats.games++;
		stats.goalsFor += us.score ?? 0;
		stats.goalsAgainst += them.score ?? 0;
		const line = teamStats?.find((t) => t.teamId === us.id);
		if (!line) continue;
		stats.boxGames++;
		stats.shots += line.shots ?? 0;
		stats.shotsOnGoal += line.shotsOnGoal ?? 0;
		stats.groundBalls += line.groundBalls ?? 0;
		stats.turnovers += line.turnovers ?? 0;
		stats.causedTurnovers += line.causedTurnovers ?? 0;
		stats.saves += line.saves ?? 0;
		stats.faceoffsWon += line.faceoffsWon ?? 0;
		stats.faceoffsLost += line.faceoffsLost ?? 0;
		stats.drawControls += line.drawControls ?? 0;
		stats.clears += line.clears ?? 0;
		stats.clearAttempts += line.clearAttempts ?? 0;
		stats.extraManGoals += line.extraMan?.goals ?? 0;
		stats.extraManOpportunities += line.extraMan?.opportunities ?? 0;
		stats.penalties += line.penalties?.count ?? 0;
		stats.penaltyMinutes += Math.round(line.penalties?.minutes ?? 0);
	}
	for (const r of results.slice(-10)) add(records.lastTen, r);
	const last = results[results.length - 1];
	if (last) {
		let n = 0;
		for (let i = results.length - 1; i >= 0 && results[i] === last; i--) n++;
		records.streak = `${last}${n}`;
	}
	return { records, stats };
}

/** Meetings between the two teams before `before`, from `finals` of either team. */
export function seriesOf(
	finals: StoredTeamFinal[],
	away: V1Team,
	home: V1Team,
	before: string,
	since: string,
): V1Series {
	const series: V1Series = {
		since,
		awayWins: 0,
		homeWins: 0,
		ties: 0,
		games: [],
	};
	if (!away.seoName || !home.seoName) return series;
	const pair = new Set([away.seoName, home.seoName]);
	const seen = new Set<string>();
	for (const { game } of finals) {
		if (seen.has(game.id) || game.date < since || game.date >= before) continue;
		if (!pair.has(game.home.seoName) || !pair.has(game.away.seoName)) continue;
		if (game.home.seoName === game.away.seoName) continue;
		if (game.home.score === null || game.away.score === null) continue;
		seen.add(game.id);
		const winner =
			game.home.score > game.away.score
				? game.home.seoName
				: game.away.score > game.home.score
					? game.away.seoName
					: null;
		if (winner === away.seoName) series.awayWins++;
		else if (winner === home.seoName) series.homeWins++;
		else series.ties++;
		series.games.push({
			gameId: game.id,
			date: game.date,
			homeSeoName: game.home.seoName,
			homeScore: game.home.score,
			awayScore: game.away.score,
			winner,
		});
	}
	series.games.sort((a, b) => b.date.localeCompare(a.date));
	return series;
}

const CLASS_ALIASES: [RegExp, string][] = [
	[/^(fr|fy|fresh|first|1st|1)/, "Fr"],
	[/^(so|soph|second|2nd|2)/, "So"],
	[/^(jr|ju|third|3rd|3)/, "Jr"],
	[/^(sr|se|fourth|4th|4)/, "Sr"],
	[/^(gr|gs|grad|fifth|5th|5|sixth|6th|6|super)/, "Gr"],
];

/** "R-Fr", "Fy", "First Year", "5th", "Grad Student" -> Fr/So/Jr/Sr/Gr. */
export function classBucket(year: string | null): string | null {
	const raw = (year ?? "").toLowerCase().trim();
	if (/^(rs|rf|r|redshirt)$/.test(raw)) return "Fr";
	const y = raw
		.replace(/^(r-|rs-?|redshirt\s+|r\s+)/, "")
		.replace(/[^a-z0-9]/g, "");
	if (!y) return null;
	return CLASS_ALIASES.find(([re]) => re.test(y))?.[1] ?? null;
}

function inches(h: string | null): number | null {
	const m = h ? /(\d)\s*['’-]\s*(\d{1,2})/.exec(h) : null;
	return m ? Number(m[1]) * 12 + Number(m[2]) : null;
}

export function rosterSummary(
	roster: V1RosterPlayer[],
): V1MatchupRoster | null {
	if (!roster.length) return null;
	const hs = roster
		.map((p) => inches(p.height))
		.filter((x): x is number => x !== null);
	const ws = roster.map((p) => p.weight).filter((x): x is number => !!x);
	const avg = (xs: number[]) =>
		xs.length
			? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10
			: null;
	const classes: Record<string, number> = {};
	for (const p of roster) {
		const c = classBucket(p.year);
		if (c) classes[c] = (classes[c] ?? 0) + 1;
	}
	return {
		players: roster.length,
		avgHeightIn: avg(hs),
		avgWeight: avg(ws),
		classes,
	};
}

async function rosterFor(
	game: V1Game,
	team: V1Team,
	season: string,
): Promise<V1MatchupRoster | null> {
	try {
		const sport = game.sport as Sport;
		const division = game.division as Division;
		const id = await lookupTeam(
			sport,
			division,
			team.seoName || team.shortName,
		);
		if (!id) return null;
		const { data } = await getTeam(sport, division, id, season);
		return data ? rosterSummary(data.roster) : null;
	} catch {
		return null;
	}
}

async function finalsFor(
	sport: string,
	team: V1Team,
	from: string,
	to: string,
) {
	return team.seoName ? listTeamFinals(sport, team.seoName, from, to) : [];
}

export async function getMatchup(
	id: string,
): Promise<Served<V1Matchup> | null> {
	const hit = (cache.get(id) ?? (await cache.getShared(id))) as
		| V1Matchup
		| undefined;
	if (hit)
		return { data: hit, updatedAt: new Date().toISOString(), stale: false };
	const served = await getGameById(id);
	if (!served) return null;
	const game = served.data;
	const season = game.date.slice(0, 4);
	const from = `${season}-01-01`;
	const [homeFinals, awayFinals, history, homeRoster, awayRoster] =
		await Promise.all([
			finalsFor(game.sport, game.home, from, game.date),
			finalsFor(game.sport, game.away, from, game.date),
			finalsFor(game.sport, game.home, `${SERIES_SINCE}-01-01`, game.date),
			rosterFor(game, game.home, season),
			rosterFor(game, game.away, season),
		]);
	const side = (
		t: V1Team,
		finals: StoredTeamFinal[],
		roster: V1MatchupRoster | null,
	) => ({
		seoName: t.seoName || null,
		name: t.shortName || t.name,
		...summarizeTeam(t, finals, game.date),
		roster,
	});
	const data: V1Matchup = {
		gameId: game.id,
		season,
		before: game.date,
		away: side(game.away, awayFinals, awayRoster),
		home: side(game.home, homeFinals, homeRoster),
		thisSeason: {
			...seriesOf(homeFinals, game.away, game.home, game.date, from),
			since: season,
		},
		allTime: {
			...seriesOf(
				history,
				game.away,
				game.home,
				game.date,
				`${SERIES_SINCE}-01-01`,
			),
			since: SERIES_SINCE,
		},
	};
	cache.set(id, data);
	return { data, updatedAt: new Date().toISOString(), stale: false };
}
