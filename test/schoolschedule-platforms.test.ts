import { describe, expect, test } from "bun:test";
import {
	parsePrestoRss,
	parsePrestoSchedule,
	wmtEventsToSchool,
} from "../src/v1/schoolschedule";

const fx = (n: string) =>
	Bun.file(`${import.meta.dir}/fixtures/schoolschedule/${n}`).text();

describe("WMT schedule-events", () => {
	test("renders UTC datetimes in the school's zone; side, venue, TBA", async () => {
		const { data } = JSON.parse(await fx("wmt-events-2027.json"));
		const events = wmtEventsToSchool(data, "America/New_York") ?? [];
		expect(events.length).toBe(17);
		expect(events[0]).toMatchObject({
			date: "2027-02-06",
			time: "2:00 PM",
			at: "A",
			opponent: "Louisville",
			venue: "UofL Lacrosse Stadium",
		});
		expect(events[1]).toMatchObject({ date: "2027-02-14", at: "H" });
		expect(events[2]).toMatchObject({ opponent: "Ohio St.", time: null });
	});
	test("west-coast zone shifts the date back across midnight UTC", () => {
		const ev = wmtEventsToSchool(
			[
				{
					datetime: "2027-02-07T03:00:00.000000Z",
					opponent_name: "Oregon",
					venue_type: "home",
				},
			],
			"America/Los_Angeles",
		);
		expect(ev?.[0]).toMatchObject({
			date: "2027-02-06",
			time: "7:00 PM",
			at: "H",
		});
	});
	test("nothing without rows", () => {
		expect(wmtEventsToSchool([], "America/New_York")).toBeNull();
	});
});

describe("PrestoSports schedules", () => {
	test("dates rows from the month section; time, venue, side", async () => {
		const events =
			parsePrestoSchedule(await fx("presto-2027.html"), "2027") ?? [];
		expect(events.length).toBe(4);
		expect(events[0]).toMatchObject({
			date: "2027-03-03",
			time: "9:00 PM EST",
			at: "A",
			opponent: "Northwest Nazarene",
			venue: "NNU Soccer & LAX Field",
		});
		expect(events.find((e) => e.opponent === "Emory & Henry")).toMatchObject({
			date: "2027-03-04",
			time: "6:00 PM EST",
		});
		expect(events.some((e) => e.date.startsWith("2027-04"))).toBe(true);
		expect(events.filter((e) => e.time === null).length).toBe(2);
	});

	test("event-group layout: full date in the title attribute, side in .va, H/A in .venue", async () => {
		const events =
			parsePrestoSchedule(await fx("presto-eventgroup-2027.html"), "2027") ??
			[];
		expect(events.length).toBe(16);
		expect(events[0]).toMatchObject({
			date: "2027-02-03",
			time: "1:00 PM",
			at: "H",
			opponent: "Emmanuel (Ga.)",
			venue: null,
		});
		expect(events.filter((e) => e.at === "A").length).toBe(6);
	});
});

describe("PrestoSports RSS", () => {
	test("date/time from the description, side from the opponent prefix", async () => {
		const events = parsePrestoRss(await fx("presto-rss-2027.xml")) ?? [];
		expect(events.length).toBe(14);
		expect(events[0]).toMatchObject({
			date: "2027-02-06",
			time: "7:00 PM",
			at: "H",
			opponent: "Lander",
			venue: null,
		});
		expect(events[13]).toMatchObject({
			date: "2027-04-28",
			time: "4:00 PM",
			at: "A",
			opponent: "Wingate",
		});
	});
});
