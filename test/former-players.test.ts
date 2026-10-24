import { describe, expect, test } from "bun:test";
import {
	type V1RosterPlayer,
	type V1TeamDetail,
	withFormerPlayers,
} from "../src/v1/teams";

const stats = {
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
const player = (name: string, number: string): V1RosterPlayer => ({
	id: name,
	number,
	name,
	position: null,
	year: null,
	hometown: null,
	height: null,
	weight: null,
	highSchool: null,
	previousSchool: null,
	gamesPlayed: null,
	gamesStarted: null,
	stats,
});
const team = (rosterSeason: string | null) =>
	({
		season: "2026",
		rosterSeason,
		roster: [player("Ryan Remaly", "4")],
	}) as unknown as V1TeamDetail;
const official = {
	players: [
		{
			number: "4",
			name: "Ryan Remaly",
			gamesPlayed: 20,
			gamesStarted: 20,
			stats: { ...stats, goals: 25 },
		},
		{
			number: "11",
			name: "Brigid Duffy",
			gamesPlayed: 20,
			gamesStarted: 20,
			stats: { ...stats, goals: 77, assists: 31 },
		},
	],
};

describe("withFormerPlayers", () => {
	test("keeps season lines missing from a next-season roster", () => {
		const out = withFormerPlayers(team("2027"), official);
		expect(
			out.formerPlayers?.map((p) => [p.name, p.gamesPlayed, p.stats.assists]),
		).toEqual([["Brigid Duffy", 20, 31]]);
	});
	test("adds nothing when the roster is the season's own", () => {
		expect(
			withFormerPlayers(team(null), official).formerPlayers,
		).toBeUndefined();
		expect(
			withFormerPlayers(team("2026"), official).formerPlayers,
		).toBeUndefined();
	});
});
