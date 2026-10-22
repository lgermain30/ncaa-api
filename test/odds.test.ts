import { describe, expect, test } from "bun:test";
import { findOdds, mergeOdds, nameScore, parseOdds } from "../src/v1/odds";
import type { V1Game, V1Team } from "../src/v1/types";

const team = (
	name: string,
	seoName = name.toLowerCase().replace(/\s+/g, "-"),
): V1Team => ({
	id: null,
	name,
	shortName: name,
	seoName,
	char6: "",
	color: null,
	score: null,
	rank: null,
	seed: null,
	record: null,
	conference: null,
	isWinner: false,
});

const game = (
	away: string,
	home: string,
	date = "2027-03-06",
	sport = "lacrosse-men",
): V1Game => ({
	id: "1",
	sport,
	division: "d1",
	date,
	startEpoch: null,
	startTime: "TBA",
	status: {
		state: "pre",
		period: "",
		clock: "",
		display: "",
		finalMessage: "",
	},
	home: team(home),
	away: team(away),
	linescore: [],
	linescoreSource: "ncaa",
	venue: null,
	broadcast: { network: null, liveVideo: false },
	attendance: null,
	bracket: null,
	links: { ncaa: null },
	detailed: false,
	updatedAt: "",
});

const raw = (
	home: string,
	away: string,
	commence = "2027-03-06T17:00:00Z",
) => ({
	id: `${home}-${away}`,
	commence_time: commence,
	home_team: home,
	away_team: away,
	bookmakers: [
		{
			key: "betus",
			title: "BetUS",
			last_update: "2027-03-05T12:00:00Z",
			markets: [
				{
					key: "spreads",
					outcomes: [
						{ name: home, point: -3, price: -110 },
						{ name: away, point: 3, price: -110 },
					],
				},
			],
		},
		{
			key: "draftkings",
			title: "DraftKings",
			last_update: "2027-03-05T12:00:00Z",
			markets: [
				{
					key: "spreads",
					outcomes: [
						{ name: away, point: 2.5, price: -105 },
						{ name: home, point: -2.5, price: -115 },
					],
				},
			],
		},
	],
});

describe("odds", () => {
	test("prefers DraftKings and reads both sides", () => {
		const [e] = parseOdds([raw("Princeton Tigers", "Syracuse Orange")]);
		expect(e).toMatchObject({
			book: "DraftKings",
			homePoint: -2.5,
			awayPoint: 2.5,
			homePrice: -115,
		});
		expect(parseOdds([{ ...raw("A", "B"), bookmakers: [] }])).toEqual([]);
	});

	test("matches school names to Odds API names", () => {
		expect(nameScore("Syracuse Orange", team("Syracuse"))).toBeGreaterThan(0);
		expect(
			nameScore("Saint Joseph's Hawks", team("St. Joseph's")),
		).toBeGreaterThan(0);
		expect(nameScore("Penn State Nittany Lions", team("Penn"))).toBe(0);
		expect(nameScore("Penn Quakers", team("Penn State"))).toBe(0);
		expect(
			nameScore("Notre Dame Fighting Irish", team("Notre Dame")),
		).toBeGreaterThan(0);
	});

	test("attaches the spread to the right game, by ET date and sides", () => {
		const list = parseOdds([
			raw("Princeton Tigers", "Syracuse Orange"),
			raw("Penn State Nittany Lions", "Yale Bulldogs"),
		]);
		expect(findOdds(game("Syracuse", "Princeton"), list)?.spread).toEqual({
			home: -2.5,
			away: 2.5,
			homePrice: -115,
			awayPrice: -105,
		});
		// neutral site listed the other way round
		expect(findOdds(game("Princeton", "Syracuse"), list)?.spread.home).toBe(
			2.5,
		);
		expect(findOdds(game("Yale", "Penn"), list)).toBeNull();
		expect(
			findOdds(game("Syracuse", "Princeton", "2027-03-07"), list),
		).toBeNull();
		expect(
			findOdds(
				game("Syracuse", "Princeton", "2027-03-06", "lacrosse-women"),
				list,
			),
		).toBeNull();
		// 11 PM ET is still the same ET date
		const late = parseOdds([
			raw("Princeton Tigers", "Syracuse Orange", "2027-03-07T04:00:00Z"),
		]);
		expect(findOdds(game("Syracuse", "Princeton"), late)).not.toBeNull();
	});

	test("keeps lines for started games, drops old ones", () => {
		const now = Date.parse("2027-03-10T00:00:00Z");
		const [a] = parseOdds([raw("Princeton Tigers", "Syracuse Orange")]);
		const [old] = parseOdds([
			raw("Duke Blue Devils", "Navy Midshipmen", "2027-01-01T17:00:00Z"),
		]);
		expect(mergeOdds([a, old], [], now).map((e) => e.id)).toEqual([a.id]);
		const moved = { ...a, homePoint: -1.5 };
		expect(mergeOdds([a], [moved], now)[0].homePoint).toBe(-1.5);
	});
});
