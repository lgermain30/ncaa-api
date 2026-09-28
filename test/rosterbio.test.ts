import { describe, expect, it } from "bun:test";
import {
	hostOf,
	matchBio,
	normalizeHeight,
	parseRosterHtml,
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
		expect(matchBio(bio, { number: "99", name: "Jose Nunez" })?.weight).toBe(
			160,
		);
		expect(matchBio(null, { number: "1", name: "x" })).toBeNull();
	});
});
