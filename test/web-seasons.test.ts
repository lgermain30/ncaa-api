import { describe, expect, test } from "bun:test";
import type { V1TeamGame } from "../src/v1/teams";
import {
	mergeWebSchedule,
	normalizeWebSeason,
	type WebSeason,
} from "../src/v1/webseasons";

const ncaaRow = (date: string, us: number, them: number): V1TeamGame => ({
	date,
	time: null,
	opponent: { id: null, name: "X", seoName: "x", rank: null },
	home: true,
	final: true,
	score: { us, them },
	result: us > them ? "W" : "L",
	playoff: null,
	gameId: "1",
});

const web = (games: WebSeason["games"]): WebSeason => ({
	sport: "lacrosse-women",
	season: "2016",
	slug: "utica",
	name: "Utica",
	games,
	players: [],
});

describe("normalizeWebSeason", () => {
	test("maps women's draw controls into faceoffsWon/Taken and drops bad rows", () => {
		const s = normalizeWebSeason({
			gender: "women",
			division: "d3",
			season: 2016,
			slug: "utica",
			name: "Utica",
			games: [
				{
					date: "2016-03-23",
					home: false,
					opponent: "SUNY Morrisville",
					opponentSlug: "morrisville-st",
					us: 10,
					them: 8,
					playoff: null,
				},
				{ date: "bad", opponent: "Y", us: 1, them: 2 },
			],
			players: [
				{
					name: "Rebecca Plunkett",
					number: "21",
					gamesPlayed: 16,
					goals: 40,
					assists: 2,
					drawControls: 87,
					saves: null,
				},
				{ name: "" },
			],
		});
		expect(s?.sport).toBe("lacrosse-women");
		expect(s?.games).toHaveLength(1);
		expect(s?.players).toHaveLength(1);
		expect(s?.players[0].stats.goals).toBe(40);
		expect(s?.players[0].stats.faceoffsWon).toBe(87);
		expect(s?.players[0].stats.faceoffsTaken).toBe(87);
		expect(s?.players[0].gamesStarted).toBeNull();
	});

	test("rejects rows without a team or season", () => {
		expect(normalizeWebSeason({ gender: "women", season: 2016 })).toBeNull();
		expect(
			normalizeWebSeason({ gender: "x", season: 2016, slug: "a", name: "A" }),
		).toBeNull();
	});
});

describe("mergeWebSchedule", () => {
	test("adds games NCAA lacks and skips ones it has within a day at the same score", () => {
		const rows = mergeWebSchedule(
			[ncaaRow("2016-03-23", 10, 8)],
			web([
				{
					date: "2016-03-24",
					home: false,
					opponent: "SUNY Morrisville",
					opponentSlug: "suny-morrisville",
					us: 10,
					them: 8,
					playoff: null,
				},
				{
					date: "2016-03-23",
					home: false,
					opponent: "Morrisville",
					opponentSlug: "morrisville-st",
					us: 10,
					them: 8,
					playoff: null,
				},
				{
					date: "2016-03-04",
					home: true,
					opponent: "Buffalo St.",
					opponentSlug: "buffalo-st",
					us: 11,
					them: 17,
					playoff: null,
				},
			]),
			(seo) => (seo === "buffalo-st" ? "buffalo-st-w" : null),
		);
		expect(rows.map((r) => [r.date, r.result, r.opponent.id])).toEqual([
			["2016-03-04", "L", "buffalo-st-w"],
			["2016-03-23", "W", null],
		]);
	});

	test("returns the NCAA schedule untouched without web games", () => {
		const ncaa = [ncaaRow("2016-03-23", 10, 8)];
		expect(mergeWebSchedule(ncaa, null, () => null)).toBe(ncaa);
	});
});
