import { describe, expect, it } from "bun:test";
import {
	parseStatsHtml,
	type StoredSchoolStats,
	statPersonName,
	statsAreFresh,
	statsUrls,
} from "../src/v1/schoolstats";
import { type V1TeamDetail, withSchoolStats } from "../src/v1/teams";

const read = (name: string) =>
	Bun.file(`${import.meta.dir}/fixtures/${name}`).text();

describe("school season stats", () => {
	it("parses classic Sidearm stats tables (women: DC, GB, TO)", async () => {
		const parsed = parseStatsHtml(
			await read("stats-sidearm-classic.html"),
			"lacrosse-women",
		);
		expect(parsed?.source).toBe("sidearm_classic");
		const brooke = parsed?.players.find((p) => p.name === "Brooke Meltcher");
		expect(brooke).toMatchObject({ gamesPlayed: 19, gamesStarted: 19 });
		expect(brooke?.stats).toMatchObject({
			goals: 2,
			assists: 0,
			groundBalls: 93,
			turnovers: 20,
			causedTurnovers: 43,
			faceoffsWon: 12,
			faceoffsTaken: 12,
		});
		const teff = parsed?.players.find((p) => p.name === "Norah Teff");
		expect(teff?.stats.saves).toBe(11);
		expect(
			parsed?.players.some((p) => /team|total|opponent/i.test(p.name)),
		).toBe(false);
	});

	it("parses Sidearm Nuxt overallIndividualStats (men: faceoffs W-T)", async () => {
		const parsed = parseStatsHtml(
			await read("stats-sidearm-nuxt.html"),
			"lacrosse-men",
		);
		expect(parsed?.source).toBe("sidearm_nuxt");
		expect(parsed?.players).toHaveLength(45);
		const fyock = parsed?.players.find((p) => p.name === "Caleb Fyock");
		expect(fyock).toMatchObject({
			number: "18",
			gamesPlayed: 14,
			gamesStarted: 14,
		});
		expect(fyock?.stats).toMatchObject({
			groundBalls: 34,
			turnovers: 7,
			causedTurnovers: 9,
			saves: 120,
			shotsFaced: 372,
		});
		const oldman = parsed?.players.find((p) => p.name === "Jack Oldman");
		expect(oldman?.stats).toMatchObject({
			faceoffsWon: 103,
			faceoffsTaken: 170,
		});
	});

	it("returns null for pages without stats", () => {
		expect(
			parseStatsHtml("<html><body>schedule</body></html>", "lacrosse-men"),
		).toBeNull();
	});

	it("flips Last, First names", () => {
		expect(statPersonName("Meltcher,  Brooke")).toBe("Brooke Meltcher");
		expect(statPersonName("Brooke Meltcher")).toBe("Brooke Meltcher");
	});

	it("builds stats URLs per sport path", () => {
		expect(statsUrls("woffordterriers.com", "lacrosse-women", "2026")[0]).toBe(
			"https://woffordterriers.com/sports/womens-lacrosse/stats/2026",
		);
	});

	it("keeps finished seasons for good, refreshes the current one", () => {
		const now = new Date("2026-10-14T00:00:00Z");
		const old = { data: { players: [] }, updatedAt: "2026-01-01T00:00:00Z" };
		expect(statsAreFresh(old, "2025", now)).toBe(true);
		expect(statsAreFresh(old, "2026", now)).toBe(false);
		expect(
			statsAreFresh(
				{ data: null, updatedAt: "2026-10-13T12:00:00Z" },
				"2025",
				now,
			),
		).toBe(true);
		expect(statsAreFresh(null, "2025", now)).toBe(false);
	});
});

describe("withSchoolStats", () => {
	const stats = (gb: number) => ({
		goals: 0,
		assists: 0,
		shots: 0,
		groundBalls: gb,
		turnovers: 0,
		causedTurnovers: 0,
		faceoffsWon: 0,
		faceoffsTaken: 0,
		saves: 0,
		shotsFaced: 0,
	});
	const player = (name: string, number: string, gb: number) => ({
		id: name,
		number,
		name,
		position: "D",
		year: "Gr",
		hometown: null,
		height: null,
		weight: null,
		highSchool: null,
		previousSchool: null,
		gamesPlayed: 18,
		gamesStarted: 18,
		stats: stats(gb),
	});
	const team = {
		roster: [player("Brooke Meltcher", "3", 90), player("Jane Doe", "4", 7)],
	} as unknown as V1TeamDetail;
	const official: StoredSchoolStats = {
		host: "woffordterriers.com",
		url: "https://woffordterriers.com/sports/womens-lacrosse/stats/2026",
		source: "sidearm_classic",
		season: "2026",
		players: [
			{
				number: "3",
				name: "Brooke Meltcher",
				gamesPlayed: 19,
				gamesStarted: 19,
				stats: stats(93),
			},
		],
	};

	it("overlays official totals and keeps unmatched players' lax lines", () => {
		const out = withSchoolStats(team, official);
		expect(out.statsSource).toBe("school");
		expect(out.roster[0]).toMatchObject({ gamesPlayed: 19, gamesStarted: 19 });
		expect(out.roster[0].stats.groundBalls).toBe(93);
		expect(out.roster[1].stats.groundBalls).toBe(7);
		expect(out.roster[1].gamesPlayed).toBe(18);
	});

	it("falls back to the team unchanged without school stats", () => {
		expect(withSchoolStats(team, null)).toBe(team);
	});
});
