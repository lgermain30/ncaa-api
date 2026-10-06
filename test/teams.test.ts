import { describe, expect, test } from "bun:test";
import {
	laxDivision,
	matchKeys,
	playerName,
	positionCode,
	titleCase,
	type V1TeamGame,
	verifySchedule,
} from "../src/v1/teams";
import type { V1Game } from "../src/v1/types";

const laxGame = (date: string, us: number, them: number): V1TeamGame => ({
	date,
	time: null,
	opponent: { id: null, name: "Opp", seoName: null, rank: null },
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
});
