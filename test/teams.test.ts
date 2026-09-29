import { describe, expect, test } from "bun:test";
import {
	laxDivision,
	matchKeys,
	playerName,
	titleCase,
} from "../src/v1/teams";

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
});
