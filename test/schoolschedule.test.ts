import { describe, expect, test } from "bun:test";
import {
	matchEvent,
	normalizeTime,
	officialEvents,
	opponentName,
	parseClassicSchedule,
	parseNuxtSchedule,
	patchFrom,
} from "../src/v1/schoolschedule";
import type { V1Game, V1Team } from "../src/v1/types";

const nuxt = (arr: unknown[]) =>
	`<script type="application/json" id="__NUXT_DATA__">${JSON.stringify(arr)}</script>`;

describe("school schedule", () => {
	test("normalizes published times", () => {
		expect(normalizeTime("1 p.m.")).toBe("1:00 PM");
		expect(normalizeTime("4:00 PM ET")).toBe("4:00 PM ET");
		expect(normalizeTime("Noon")).toBe("12:00 PM");
		expect(normalizeTime("TBA")).toBeNull();
	});

	test("parses Sidearm nuxt events", () => {
		const html = nuxt([
			{
				date: 1,
				time: 2,
				tbd: 3,
				location_indicator: 4,
				opponent: 5,
				media: 7,
				facility: 9,
			},
			"2026-02-27T16:00:00",
			"4 p.m.",
			false,
			"A",
			{ title: 6 },
			"#10/#7 Princeton",
			{ tv: 8 },
			"ESPN+",
			null,
		]);
		expect(parseNuxtSchedule(html)).toEqual([
			{
				date: "2026-02-27",
				time: "4:00 PM",
				tv: "ESPN+",
				venue: null,
				at: "A",
				opponent: "#10/#7 Princeton",
			},
		]);
	});

	test("parses classic Sidearm rows", () => {
		const html = `<li class="sidearm-schedule-game sidearm-schedule-home-game">
			<div class="sidearm-schedule-game-opponent-date"><span>Feb 25 (Wed)</span><span>3:00 PM</span></div>
			<div class="sidearm-schedule-game-opponent-name"><a>Temple </a></div>
			<div class="sidearm-schedule-game-location"><span>Franklin Field</span></div>
			<span class="sidearm-schedule-game-coverage-tv-content"> ESPN+ </span></li>`;
		expect(parseClassicSchedule(html, "2026")).toEqual([
			{
				date: "2026-02-25",
				time: "3:00 PM",
				tv: "ESPN+",
				venue: "Franklin Field",
				at: "H",
				opponent: "Temple",
			},
		]);
	});

	test("fills only what NCAA left blank", () => {
		const team = (name: string) => ({ name, shortName: name }) as V1Team;
		const ev = (opponent: string, extra = {}) => ({
			date: "2026-02-27",
			time: "4:00 PM",
			tv: null,
			venue: "Sherrerd Field",
			at: "H" as const,
			opponent,
			...extra,
		});
		expect(
			matchEvent([ev("Syracuse"), ev("Yale")], "2026-02-27", team("Syracuse"))
				?.opponent,
		).toBe("Syracuse");
		const game = {
			startTime: "TBA",
			venue: null,
			broadcast: { network: null, liveVideo: false },
		} as unknown as V1Game;
		expect(
			patchFrom(
				game,
				ev("Syracuse"),
				ev("Princeton", { at: "A", tv: "ESPN+" }),
			),
		).toEqual({
			network: "ESPN+",
			startTime: "4:00 PM",
			venue: { name: "Sherrerd Field", city: "", state: "" },
		});
	});

	test("dates fall ball on the season page to the year before", () => {
		const row = (d: string, opp: string) =>
			`<li class="sidearm-schedule-game sidearm-schedule-home-game"><div class="sidearm-schedule-game-opponent-date"><span>${d}</span></div><span class="sidearm-schedule-game-opponent-name">${opp}</span></li>`;
		const events = parseClassicSchedule(
			row("Oct 3 (Sat)", "Alumni Game") + row("Feb 6 (Sat)", "Drexel"),
			"2027",
		);
		expect(events?.map((e) => e.date)).toEqual(["2026-10-03", "2027-02-06"]);
		// 2026's page served for 2027: Feb 2 was a Monday in 2026, not 2027.
		expect(
			parseClassicSchedule(row("Feb 2 (Mon)", "Robert Morris"), "2027"),
		).toBeNull();
	});

	test("keeps only the season's official games", () => {
		const ev = (date: string, opponent: string) => ({
			date,
			time: null,
			tv: null,
			venue: null,
			at: "H" as const,
			opponent,
		});
		const kept = officialEvents(
			[
				ev("2027-02-13", "Georgetown"),
				ev("2026-10-10", "Delaware (Scrimmage)"),
				ev("2027-01-30", "Saint Joseph's (Scrimmage)"),
				ev("2027-02-06", "Drexel"),
				ev("2027-02-01", "Exhibition vs. Team USA"),
			],
			"2027",
		);
		expect(kept.map((e) => e.opponent)).toEqual(["Drexel", "Georgetown"]);
		expect(opponentName("#10/#7 Ohio State (Homecoming)")).toBe("Ohio State");
		expect(opponentName("No. 3 Duke *")).toBe("Duke");
		expect(opponentName("RV University at Albany")).toBe(
			"University at Albany",
		);
	});
});
