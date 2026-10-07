import { describe, expect, test } from "bun:test";
import {
	laxDivision,
	matchKeys,
	playerName,
	positionCode,
	titleCase,
	type V1RosterPlayer,
	type V1TeamDetail,
	type V1TeamGame,
	verifySchedule,
	withGamesPlayed,
} from "../src/v1/teams";
import { resetStore, upsertDetail, upsertGame } from "../src/store";
import type { V1Game } from "../src/v1/types";

const laxGame = (
	date: string,
	us: number,
	them: number,
	opp: string | null = null,
): V1TeamGame => ({
	date,
	time: null,
	opponent: { id: null, name: "Opp", seoName: opp, rank: null },
	home: true,
	final: true,
	score: { us, them },
	result: us > them ? "W" : "L",
	playoff: null,
});
const ncaaGame = (
	date: string,
	home: [string, number | null],
	away: [string, number | null],
) =>
	({
		id: `${date}-${home[0]}`,
		date,
		home: { seoName: home[0], score: home[1] },
		away: { seoName: away[0], score: away[1] },
	}) as unknown as V1Game;

describe("v1 teams", () => {
	test("laxDivision maps women to 4-6", () => {
		expect(laxDivision("lacrosse-men", "d1")).toBe(1);
		expect(laxDivision("lacrosse-men", "d3")).toBe(3);
		expect(laxDivision("lacrosse-women", "d1")).toBe(4);
		expect(laxDivision("lacrosse-women", "d3")).toBe(6);
	});

	test("titleCase fixes lax.com lowercase names", () => {
		expect(titleCase("johns hopkins")).toBe("Johns Hopkins");
		expect(titleCase("saint john's")).toBe("Saint John's");
		expect(titleCase("mount st mary")).toBe("Mount St. Mary");
	});

	test("playerName strips positions and flips Last, First", () => {
		expect(playerName("austin blumbergs a /")).toBe("austin blumbergs");
		expect(playerName("brandon ramirez face-off")).toBe("brandon ramirez");
		expect(playerName("brodie anderson close")).toBe("brodie anderson");
		expect(playerName("will whitney defense/long-stick")).toBe("will whitney");
		expect(playerName("Madlang, Dominic")).toBe("Dominic Madlang");
		expect(playerName("Marvin Johnson Jr.")).toBe("Marvin Johnson Jr.");
		expect(playerName("Onenioteko:wa Maracle")).toBe("Onenioteko:wa Maracle");
		expect(playerName("Brennan O'Neill")).toBe("Brennan O'Neill");
	});

	test("positionCode shortens school-site positions", () => {
		expect(positionCode("Attackman")).toBe("A");
		expect(positionCode("DEFENSEMAN/LONGSTICK MIDFIELDER")).toBe("D/LSM");
		expect(positionCode("Attackman/Midfielder")).toBe("A/M");
		expect(positionCode("Defensive Midfielder")).toBe("SSDM");
		expect(positionCode("Faceoff")).toBe("FO");
		expect(positionCode("Goalkeeper")).toBe("G");
		expect(positionCode("fo/m")).toBe("FO/M");
		expect(positionCode(null)).toBeNull();
	});

	test("matchKeys lines up NCAA and lax.com spellings", () => {
		const shares = (a: string, b: string) =>
			matchKeys(a).some((k) => matchKeys(b).includes(k));
		expect(shares("st-johns-ny", "saint-johns")).toBe(true);
		expect(shares("University at Albany", "albany-w")).toBe(true);
		expect(shares("penn-st", "pennstate-w")).toBe(true);
		expect(shares("Boston College", "bostoncollege-w")).toBe(true);
		expect(shares("Colorado College", "colorado-college")).toBe(true);
		// strict key first so Boston College never lands on Boston University
		expect(matchKeys("boston-college")[0]).toBe("bostoncollege");
		expect(matchKeys("penn")).not.toContain("pennstate");
	});

	test("verifySchedule agrees, flags disagreements, skips unmatched", () => {
		const byDate = new Map<string, V1Game[]>([
			[
				"2017-03-04",
				[ncaaGame("2017-03-04", ["denver", 12], ["marquette", 9])],
			],
			["2017-03-11", [ncaaGame("2017-03-11", ["duke", 10], ["denver", 11])]],
			[
				"2017-03-18",
				[ncaaGame("2017-03-18", ["denver", null], ["ohio-st", null])],
			],
		]);
		const ok = verifySchedule(
			[
				laxGame("2017-03-04", 12, 9),
				laxGame("2017-03-11", 11, 10),
				laxGame("2017-03-18", 9, 8),
				laxGame("2017-03-25", 7, 6),
			],
			"denver",
			byDate,
		);
		expect(ok.checked).toBe(2);
		expect(ok.agreed).toBe(2);
		expect(ok.unmatched).toBe(1);
		expect(ok.verified).toBe(true);

		const bad = verifySchedule(
			[laxGame("2017-03-04", 13, 9)],
			"denver",
			byDate,
		);
		expect(bad.verified).toBe(false);
		expect(bad.disagreed[0]).toEqual({
			date: "2017-03-04",
			opponent: "Opp",
			lax: { us: 13, them: 9 },
			ncaa: { us: 12, them: 9 },
		});

		expect(
			verifySchedule([laxGame("2017-03-04", 12, 9)], null, byDate).verified,
		).toBe(false);
	});

	test("verifySchedule tolerates a one-day lax.com date shift and ignores 0-0 finals", () => {
		const byDate = new Map<string, V1Game[]>([
			[
				"2019-03-02",
				[ncaaGame("2019-03-02", ["cornell", 17], ["albany-ny", 16])],
			],
			["2021-03-13", [ncaaGame("2021-03-13", ["delaware", 0], ["drexel", 0])]],
		]);
		const shifted = verifySchedule(
			[laxGame("2019-03-03", 16, 17, "cornell")],
			"albany-ny",
			byDate,
		);
		expect(shifted.checked).toBe(1);
		expect(shifted.verified).toBe(true);
		// unknown opponent: exact date only
		const noOpp = verifySchedule(
			[laxGame("2019-03-03", 16, 17)],
			"albany-ny",
			byDate,
		);
		expect(noOpp.unmatched).toBe(1);
		const zero = verifySchedule(
			[laxGame("2021-03-13", 19, 12, "drexel")],
			"delaware",
			byDate,
		);
		expect(zero.checked).toBe(0);
		expect(zero.verified).toBe(false);
	});
});

describe("games played from stored box scores", () => {
	const game = (id: string, state = "final") =>
		({
			id,
			sport: "lacrosse-men",
			division: "d1",
			date: "2026-03-0" + id,
			status: { state },
			home: { id: "457", seoName: "north-carolina", name: "UNC" },
			away: { id: "999", seoName: "duke", name: "Duke" },
		}) as unknown as V1Game;
	const line = (
		name: string,
		number: number,
		starter: boolean,
		teamId = "457",
	) => {
		const [firstName, lastName] = name.split(" ");
		return {
			teamId,
			name: name.toUpperCase(),
			firstName,
			lastName,
			number,
			starter,
			played: true,
		};
	};
	const player = (name: string, number: string, goals = 0) =>
		({
			id: name,
			number,
			name,
			gamesPlayed: null,
			gamesStarted: null,
			stats: {
				goals,
				assists: 0,
				shots: 0,
				groundBalls: 0,
				turnovers: 0,
				causedTurnovers: 0,
				faceoffsWon: 0,
				faceoffsTaken: 0,
				saves: 0,
				shotsFaced: 0,
			},
		}) as unknown as V1RosterPlayer;

	test("counts finals for the team's own players, matched by name", async () => {
		resetStore();
		for (const id of ["1", "2", "3"]) await upsertGame(game(id));
		await upsertGame(game("4", "live"));
		const box = (players: ReturnType<typeof line>[]) => ({
			updatedAt: new Date().toISOString(),
			players,
		});
		await upsertDetail(
			"1",
			"boxscore",
			box([
				line("Dominic Pietramala", 77, true),
				line("Nick Pietramala", 66, false),
				line("Dominic Pietramala", 77, true, "999"),
			]),
		);
		await upsertDetail(
			"2",
			"boxscore",
			box([line("Dominic Pietramala", 77, true)]),
		);
		await upsertDetail(
			"3",
			"boxscore",
			box([line("Dominic Pietramala", 77, false)]),
		);
		await upsertDetail(
			"4",
			"boxscore",
			box([line("Dominic Pietramala", 77, true)]),
		);
		const team = {
			sport: "lacrosse-men",
			division: "d1",
			season: "2026",
			seoName: "north-carolina",
			roster: [
				player("Dominic Pietramala", "77", 55),
				player("Nick Pietramala", "66"),
				player("Sam Newcomer", "99"),
				player("Pat Unmatched", "5", 3),
			],
		} as unknown as V1TeamDetail;
		const r = (await withGamesPlayed(team)).roster;
		expect([r[0].gamesPlayed, r[0].gamesStarted]).toEqual([3, 2]);
		expect([r[1].gamesPlayed, r[1].gamesStarted]).toEqual([1, 0]);
		expect(r[2].gamesPlayed).toBe(0);
		expect(r[3].gamesPlayed).toBeNull();
		const none = await withGamesPlayed({ ...team, season: "2019" });
		expect(none.roster[0].gamesPlayed).toBeNull();
	});
});
