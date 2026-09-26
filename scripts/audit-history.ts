/*
 * Historical coverage audit: for each season and board, probe NCAA for a
 * scoreboard on a few in-season Saturdays, then probe one game found for
 * gamecenter / box score / team stats / play-by-play. Read-only.
 *
 *   bun run scripts/audit-history.ts [fromYear] [toYear]
 */
import {
	fetchGamecenterContest,
	fetchLacrosseBoxscore,
	fetchLacrosseTeamStats,
	fetchPlayByPlay,
	fetchScoreboardContests,
} from "../src/v1/fetch";

const SPORTS = ["lacrosse-men", "lacrosse-women"];
const DIVISIONS = ["d1", "d2", "d3"];
const from = Number(process.argv[2] ?? 2010);
const to = Number(process.argv[3] ?? new Date().getFullYear());

function saturdaysIn(year: number, month: number): string[] {
	const out: string[] = [];
	for (let d = 1; d <= 31; d++) {
		const dt = new Date(Date.UTC(year, month - 1, d, 12));
		if (dt.getUTCMonth() !== month - 1) break;
		if (dt.getUTCDay() === 6) out.push(dt.toISOString().slice(0, 10));
	}
	return out;
}

interface Row {
	season: number;
	sport: string;
	division: string;
	dateProbed: string | null;
	games: number;
	scoresPresent: boolean;
	linescore: boolean;
	gamecenter: boolean;
	venue: boolean;
	attendance: boolean;
	boxscorePlayers: boolean;
	teamStats: boolean;
	pbpPlays: number;
	error: string | null;
}

async function probe(
	season: number,
	sport: string,
	division: string,
): Promise<Row> {
	const row: Row = {
		season,
		sport,
		division,
		dateProbed: null,
		games: 0,
		scoresPresent: false,
		linescore: false,
		gamecenter: false,
		venue: false,
		attendance: false,
		boxscorePlayers: false,
		teamStats: false,
		pbpPlays: 0,
		error: null,
	};
	const candidates = [
		...saturdaysIn(season, 4).slice(0, 2),
		...saturdaysIn(season, 3).slice(1, 3),
	];
	try {
		for (const date of candidates) {
			const contests = await fetchScoreboardContests(sport, division, date);
			if (!contests.length) continue;
			row.dateProbed = date;
			row.games = contests.length;
			const finished = contests.find(
				(c) => c.gameState === "F" || String(c.gameState).startsWith("F"),
			);
			const c = finished ?? contests[0];
			row.scoresPresent = c.teams.some((t) => Number(t.score) > 0);
			row.linescore =
				c.linescores?.some((l) => Number(l.home) > 0 || Number(l.visit) > 0) ??
				false;
			const id = String(c.contestId);
			const [gc, box, ts, pbp] = await Promise.allSettled([
				fetchGamecenterContest(id),
				fetchLacrosseBoxscore(id),
				fetchLacrosseTeamStats(id),
				fetchPlayByPlay(id),
			]);
			if (gc.status === "fulfilled" && gc.value) {
				row.gamecenter = true;
				row.venue = Boolean(gc.value.location?.venue);
				row.attendance = Number(gc.value.attendance) > 0;
			}
			if (box.status === "fulfilled" && box.value) {
				row.boxscorePlayers = (box.value.teamBoxscore ?? []).some(
					(t) => (t.playerStats?.length ?? 0) > 0,
				);
			}
			if (ts.status === "fulfilled" && ts.value) {
				row.teamStats = (ts.value.teamBoxscore ?? []).some(
					(t) => Number(t.teamStats?.goals) > 0,
				);
			}
			if (pbp.status === "fulfilled" && pbp.value) {
				row.pbpPlays = (pbp.value.periods ?? []).reduce(
					(n, p) =>
						n +
						(p.playbyplayStats ?? []).reduce(
							(m, s) => m + (s.plays?.length ?? 0),
							0,
						),
					0,
				);
			}
			break;
		}
	} catch (e) {
		row.error = e instanceof Error ? e.message : String(e);
	}
	return row;
}

const rows: Row[] = [];
for (let season = from; season <= to; season++) {
	const batch = await Promise.all(
		SPORTS.flatMap((s) => DIVISIONS.map((d) => probe(season, s, d))),
	);
	for (const r of batch) {
		rows.push(r);
		console.log(JSON.stringify(r));
	}
}
