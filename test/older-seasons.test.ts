import { describe, expect, test } from "bun:test";
import type { StoredTeamFinal } from "../src/store";
import { olderSeasons, scheduleFromFinals } from "../src/v1/teams";
import type { V1Game } from "../src/v1/types";

const side = (seoName: string, score: number | null) =>
	({
		seoName,
		name: seoName,
		shortName: seoName.toUpperCase(),
		score,
		rank: null,
	}) as V1Game["home"];
const final = (
	id: string,
	date: string,
	home: V1Game["home"],
	away: V1Game["home"],
): StoredTeamFinal => ({
	game: { id, date, home, away, bracket: null } as unknown as V1Game,
	teamStats: null,
});

describe("scheduleFromFinals", () => {
	test("orients each final to the team and links opponents on the board", () => {
		const rows = scheduleFromFinals(
			"utica",
			[
				final("1", "2019-03-02", side("utica", 12), side("alfred", 7)),
				final("2", "2019-03-09", side("ithaca", 15), side("utica", 9)),
				final("3", "2019-03-16", side("nazareth", null), side("utica", null)),
			],
			(seo) => (seo === "alfred" ? "alfred-w" : null),
		);
		expect(rows).toEqual([
			{
				date: "2019-03-02",
				time: null,
				opponent: {
					id: "alfred-w",
					name: "ALFRED",
					seoName: "alfred",
					rank: null,
				},
				home: true,
				final: true,
				score: { us: 12, them: 7 },
				result: "W",
				playoff: null,
				gameId: "1",
			},
			{
				date: "2019-03-09",
				time: null,
				opponent: { id: null, name: "ITHACA", seoName: "ithaca", rank: null },
				home: false,
				final: true,
				score: { us: 9, them: 15 },
				result: "L",
				playoff: null,
				gameId: "2",
			},
		]);
	});
});

describe("olderSeasons", () => {
	test("adds only years before lax.com's first season that have NCAA finals", () => {
		expect(
			olderSeasons(
				["2023", "2024", "2025", "2026"],
				["2014-04-05", "2016-03-01", "2016-04-02", "2023-03-01"],
			),
		).toEqual(["2014", "2016", "2023", "2024", "2025", "2026"]);
	});
});
