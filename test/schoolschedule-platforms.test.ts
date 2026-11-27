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
					location: "Aztec Field",
				},
			],
			"America/Los_Angeles",
		);
		expect(ev?.[0]).toMatchObject({
			date: "2027-02-06",
			time: "7:00 PM",
			at: "H",
			venue: "Aztec Field",
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

	test("away times move to the school's clock; '@ Site' is neutral", () => {
		const item = (desc: string, opp: string, dc: string) =>
			`<item><description>${desc}</description><dc:date>${dc}</dc:date><ps:opponent>${opp}</ps:opponent></item>`;
		const xml =
			item(
				"Men's Lacrosse on Feb 6, 2027 at 7:00 PM: X vs. Home",
				"Lander",
				"2027-02-07T00:00:00Z",
			) +
			item(
				"Men's Lacrosse on Mar 3, 2027 at 7:00 PM: NNU vs. Home",
				"at Northwest Nazarene",
				"2027-03-04T02:00:00Z",
			) +
			item(
				"Men's Lacrosse on Apr 1, 2027 at 1:00 PM: Home vs. Wingate",
				"vs. Wingate @ Charlotte, N.C.",
				"2027-04-01T17:00:00Z",
			);
		const ev = parsePrestoRss(xml) ?? [];
		expect(ev[0]).toMatchObject({ at: "H", time: "7:00 PM" });
		expect(ev[1]).toMatchObject({
			at: "A",
			date: "2027-03-03",
			time: "9:00 PM",
			opponent: "Northwest Nazarene",
		});
		expect(ev[2]).toMatchObject({
			at: "N",
			time: "1:00 PM",
			opponent: "Wingate",
			venue: "Charlotte, N.C.",
		});
	});
	test("without a home game to fix the zone, away clocks are left unavailable", () => {
		const ev =
			parsePrestoRss(
				`<item><description>Men's Lacrosse on Mar 3, 2027 at 7:00 PM: a</description><dc:date>2027-03-04T02:00:00Z</dc:date><ps:opponent>at NNU</ps:opponent></item>`,
			) ?? [];
		expect(ev[0]).toMatchObject({ at: "A", time: null });
	});

	test("a DST-only Pacific home slate resolves to Los Angeles, not Phoenix", () => {
		const item = (desc: string, opp: string, dc: string) =>
			`<item><description>${desc}</description><dc:date>${dc}</dc:date><ps:opponent>${opp}</ps:opponent></item>`;
		const ev =
			parsePrestoRss(
				item("on Apr 3, 2027 at 1:00 PM: a", "Oregon", "2027-04-03T20:00:00Z") +
					item(
						"on Feb 6, 2027 at 7:00 PM: b",
						"at Denver",
						"2027-02-07T02:00:00Z",
					),
			) ?? [];
		// 7:00 PM Mountain standard = 02:00Z = 6:00 PM Pacific standard
		expect(ev[1]).toMatchObject({
			at: "A",
			date: "2027-02-06",
			time: "6:00 PM",
		});
	});
});
