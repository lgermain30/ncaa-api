import { describe, expect, it } from "bun:test";
import {
	bioIsFresh,
	bioKey,
	hostOf,
	matchBio,
	normalizeHeight,
	parseRosterHtml,
	rosterUrls,
} from "../src/v1/rosterbio";

const read = (name: string) =>
	Bun.file(`${import.meta.dir}/fixtures/${name}`).text();

describe("roster bios", () => {
	it("parses classic Sidearm roster markup", async () => {
		const parsed = parseRosterHtml(await read("roster-sidearm-classic.html"));
		expect(parsed?.source).toBe("sidearm_classic");
		const durnan = parsed?.players.find((p) => p.name === "Jack Durnan");
		expect(durnan).toMatchObject({ number: "0", height: `6'3"`, weight: 222 });
		expect(durnan?.position).toBe("G");
	});

	it("parses Sidearm Nuxt __NUXT_DATA__ rosters", async () => {
		const parsed = parseRosterHtml(await read("roster-sidearm-nuxt.html"));
		expect(parsed?.source).toBe("sidearm_nuxt");
		expect(parsed?.players.length).toBe(44);
		const jameison = parsed?.players.find((p) => p.name === "Patrick Jameison");
		expect(jameison).toMatchObject({
			number: "1",
			height: `6'0"`,
			weight: 195,
			highSchool: "Episcopal High School",
			position: "G",
			hometown: expect.any(String),
		});
	});

	it("returns null for non-Sidearm pages", () => {
		expect(parseRosterHtml("<html><body><p>hi</p></body></html>")).toBeNull();
	});

	it("normalizes heights and hosts", () => {
		expect(normalizeHeight("6-1")).toBe(`6'1"`);
		expect(normalizeHeight("5' 11''")).toBe(`5'11"`);
		expect(normalizeHeight("")).toBeNull();
		expect(
			hostOf("http://www.goduke.com/SportSelect.dbml?DB_OEM_ID=4200"),
		).toBe("goduke.com");
		expect(hostOf(null)).toBeNull();
	});

	it("keys past-season bios separately from the current roster", () => {
		expect(bioKey("lacrosse-men", "1")).toBe("lacrosse-men:1");
		expect(bioKey("lacrosse-men", "1", "2021")).toBe("lacrosse-men:1:2021");
	});

	it("matches by jersey number, then by name", () => {
		const bio = {
			host: "x",
			source: "sidearm_classic" as const,
			season: null,
			players: [
				{
					number: "7",
					name: "Sam Smith",
					height: `6'0"`,
					weight: 180,
					highSchool: null,
					position: null,
					year: null,
					hometown: null,
				},
				{
					number: "07",
					name: "Ann Smith",
					height: `5'6"`,
					weight: 140,
					highSchool: null,
					position: null,
					year: null,
					hometown: null,
				},
				{
					number: null,
					name: "José Núñez",
					height: `5'9"`,
					weight: 160,
					highSchool: null,
					position: null,
					year: null,
					hometown: null,
				},
			],
		};
		expect(matchBio(bio, { number: "7", name: "A. Smith" })?.weight).toBe(140);
		expect(matchBio(bio, { number: "7", name: "Bob Jones" })).toBeNull();
		expect(
			matchBio(
				{ ...bio, players: [bio.players[0]] },
				{ number: "7", name: "Alexander Mabbett" },
			),
		).toBeNull();
		expect(matchBio(bio, { number: "99", name: "Jose Nunez" })?.weight).toBe(
			160,
		);
		expect(matchBio(null, { number: "1", name: "x" })).toBeNull();
	});
});

describe("roster bios: other platforms", () => {
	it("parses PrestoSports roster tables", async () => {
		const parsed = parseRosterHtml(await read("roster-presto.html"));
		expect(parsed?.source).toBe("presto");
		expect(parsed?.season).toBe("2026");
		const spears = parsed?.players.find((p) => p.name === "Jack Spears");
		expect(spears).toMatchObject({
			number: "0",
			position: "Att",
			year: "Jr",
			height: `5'10"`,
			weight: 155,
			hometown: "Elkridge, Md.",
			highSchool: "Mount St. Joseph's HS",
		});
	});

	it("parses WMT Nuxt rosters (snake_case payload, academic-year title)", async () => {
		const parsed = parseRosterHtml(await read("roster-wmt-nuxt.html"));
		expect(parsed?.source).toBe("wmt_nuxt");
		expect(parsed?.season).toBe("2027");
		const meredith = parsed?.players.find((p) => p.name === "Michael Meredith");
		expect(meredith).toMatchObject({
			number: "36",
			height: `6'2"`,
			weight: 205,
			hometown: "Towson, Md.",
			highSchool: "Boys' Latin",
			position: "Defense",
			year: "3rd Year",
		});
	});

	it("parses Sidearm Vue list rosters from the embedded players JSON", async () => {
		const parsed = parseRosterHtml(await read("roster-sidearm-vue.html"));
		expect(parsed?.source).toBe("sidearm_vue");
		expect(parsed?.season).toBe("2027");
		expect(parsed?.players.length).toBe(27);
		expect(parsed?.players[0]).toMatchObject({
			number: "1",
			name: "Emily Barnette",
			position: "A",
			year: "So.",
			height: `5'8"`,
			weight: null,
			hometown: "Jacksonville, Fla.",
			highSchool: "Bartram Trail",
		});
	});

	it("tries Sidearm, WMT and Presto roster URLs for a season", () => {
		const urls = rosterUrls("example.edu", "lacrosse-men", "2025");
		expect(urls).toContain(
			"https://example.edu/sports/mens-lacrosse/roster/2025",
		);
		expect(urls).toContain(
			"https://example.edu/sports/mlax/roster/season/2024-25/",
		);
		expect(urls).toContain("https://example.edu/sports/mlax/2024-25/roster");
		const current = rosterUrls("example.edu", "lacrosse-women");
		expect(current[0]).toBe(
			"https://example.edu/sports/womens-lacrosse/roster",
		);
		expect(current.at(-1)).toMatch(/\/sports\/lacrosse\/roster\/\d{4}$/);
	});

	it("retries misses sooner than hits", () => {
		const old = new Date(Date.now() - 2 * 24 * 3600e3).toISOString();
		expect(bioIsFresh({ data: null, updatedAt: old })).toBe(false);
		expect(bioIsFresh({ data: { x: 1 }, updatedAt: old })).toBe(true);
		expect(bioIsFresh(null)).toBe(false);
	});
});
