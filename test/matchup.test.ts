import { describe, expect, test } from "bun:test";
import type { StoredTeamFinal } from "../src/store";
import { rosterSummary, seriesOf, summarizeTeam } from "../src/v1/matchup";
import type { V1RosterPlayer } from "../src/v1/teams";
import type { V1Game, V1Team, V1TeamLine } from "../src/v1/types";

const team = (
	seoName: string,
	id: string,
	score: number,
	conference = "ivy-league",
) =>
	({
		id,
		seoName,
		name: seoName,
		shortName: seoName,
		score,
		conference,
	}) as unknown as V1Team;

const final = (
	id: string,
	date: string,
	away: V1Team,
	home: V1Team,
	opts: { ot?: boolean; bracket?: boolean; box?: Partial<V1TeamLine>[] } = {},
): StoredTeamFinal => ({
	game: {
		id,
		date,
		away,
		home,
		linescore: Array.from({ length: opts.ot ? 5 : 4 }, (_, i) => ({
			period: String(i + 1),
		})),
		bracket: opts.bracket ? { round: 1 } : null,
	} as unknown as V1Game,
	teamStats: (opts.box as V1TeamLine[]) ?? null,
});

describe("matchup", () => {
	const finals = [
		final(
			"1",
			"2026-02-10",
			team("cuse", "1", 10, "acc"),
			team("princeton", "2", 12),
		),
		final("2", "2026-02-20", team("princeton", "2", 9), team("yale", "3", 8), {
			ot: true,
			box: [
				{
					teamId: "2",
					shots: 30,
					faceoffsWon: 12,
					faceoffsLost: 8,
					extraMan: { goals: 1, opportunities: 3 },
				},
			],
		}),
		final("3", "2026-03-01", team("brown", "4", 11), team("princeton", "2", 7)),
		final(
			"4",
			"2026-03-10",
			team("princeton", "2", 13),
			team("cuse", "1", 5, "acc"),
		),
	];

	test("records and stats count only finals before the game", () => {
		const { records, stats } = summarizeTeam(
			team("princeton", "2", 0),
			finals,
			"2026-03-10",
		);
		expect(records.overall).toEqual({ wins: 2, losses: 1, ties: 0 });
		expect(records.home).toEqual({ wins: 1, losses: 1, ties: 0 });
		expect(records.away).toEqual({ wins: 1, losses: 0, ties: 0 });
		expect(records.overtime).toEqual({ wins: 1, losses: 0, ties: 0 });
		expect(records.conference).toEqual({ wins: 1, losses: 1, ties: 0 });
		expect(records.streak).toBe("L1");
		expect(stats).toMatchObject({
			games: 3,
			boxGames: 1,
			goalsFor: 28,
			goalsAgainst: 29,
			shots: 30,
			faceoffsWon: 12,
			extraManOpportunities: 3,
		});
	});

	test("series counts each meeting once from the away/home perspective", () => {
		const s = seriesOf(
			[...finals, finals[0]],
			team("cuse", "1", 0),
			team("princeton", "2", 0),
			"2026-12-31",
			"2014-01-01",
		);
		expect(s).toMatchObject({ awayWins: 0, homeWins: 2, ties: 0 });
		expect(s.games.map((g) => g.gameId)).toEqual(["4", "1"]);
	});

	test("roster averages parse heights and classes", () => {
		const p = (height: string, weight: number | null, year: string) =>
			({ height, weight, year }) as unknown as V1RosterPlayer;
		expect(
			rosterSummary([
				p("6'2\"", 200, "Sr"),
				p("5-10", 180, "R-Fr"),
				p("", null, "Gr"),
			]),
		).toEqual({
			players: 3,
			avgHeightIn: 72,
			avgWeight: 190,
			classes: { Sr: 1, Fr: 1, Gr: 1 },
		});
	});
});
