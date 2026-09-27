import { beforeEach, describe, expect, it } from "bun:test";
import type { GamecenterContest } from "../src/gamecenter";
import { boardDates, inSeason, nextIntervalMs } from "../src/poller";
import {
	aggregateTeamTotals,
	getDetail,
	getGame,
	listGames,
	listLiveGames,
	resetStore,
	upsertDetail,
	upsertGame,
} from "../src/store";
import {
	classifyPlay,
	linescoreAddsUp,
	linescoreFromPlays,
	normalizeBoxscore,
	normalizeGame,
	normalizePlays,
	normalizeState,
	parseGoal,
	toInt,
} from "../src/v1/normalize";
import { toSeasonStats } from "../src/v1/teamstats";

// Shape observed from the NCAA gamecenter query for Canisius vs Iona (6538796).
const gamecenter = {
	id: "6538796",
	sportUrl: "lacrosse-men",
	division: 1,
	clock: "",
	currentPeriod: "FINAL",
	finalMessage: "FINAL",
	gameState: "F",
	statusCodeDisplay: "final",
	network: null,
	startTime: "TBA",
	startTimeEpoch: 1772859600,
	hasStartTime: false,
	linescores: [
		{ period: "1", home: "0", visit: "0" },
		{ period: "2", home: "0", visit: "0" },
		{ period: "3", home: "0", visit: "0" },
		{ period: "4", home: "0", visit: "0" },
	],
	teams: [
		{
			teamId: "43953",
			isHome: true,
			seoname: "canisius",
			nameFull: "Canisius University",
			nameShort: "Canisius",
			name6Char: "CANISI",
			score: 10,
			record: "(1-4)",
			isWinner: true,
		},
		{
			teamId: "1388929",
			isHome: false,
			seoname: "iona",
			nameFull: "Iona University",
			nameShort: "Iona",
			name6Char: "IONA",
			score: 5,
			record: "(0-8)",
			isWinner: false,
		},
	],
	liveVideos: [],
	location: {
		venue: "Demske Sports Complex",
		city: "Buffalo",
		stateUsps: "NY",
	},
} as unknown as GamecenterContest;

const pbp = {
	contestId: 6538796,
	status: "final",
	period: 4,
	teams: [
		{ isHome: true, teamId: "43953", nameShort: "Canisius" },
		{ isHome: false, teamId: "1388929", nameShort: "Iona" },
	],
	periods: [
		{
			periodNumber: 1,
			periodDisplay: "1st",
			playbyplayStats: [
				{
					teamId: "43953",
					plays: [
						{
							clock: "15:00",
							playText: "Sam Kosloski at goalie for CANISIUS.",
						},
						{
							clock: "15:00",
							playText:
								"Faceoff Micah Hanson vs Cole Gibstein won by Micah Hanson",
						},
						{ clock: "14:30", playText: "Clear attempt by CANISIUS good." },
						{
							clock: "14:10",
							playText:
								"GOAL by CANISIUS Quinn Huber, Assist by Carson Christy, goal number 3 for season.",
							homeScore: 1,
							visitorScore: 0,
						},
						{ clock: "13:00", playText: "Clear attempt by CANISIUS failed." },
					],
				},
				{
					teamId: "1388929",
					plays: [
						{ clock: "15:00", playText: "Noah Perea at goalie for IONA." },
						{
							clock: "12:00",
							playText: "Shot by IONA Jack Smith, SAVE Sam Kosloski",
						},
						{
							clock: "11:00",
							playText: "GOAL by IONA Jack Smith (MAN-UP).",
							homeScore: 1,
							visitorScore: 1,
						},
					],
				},
			],
		},
		{
			periodNumber: 2,
			periodDisplay: "2nd",
			playbyplayStats: [
				{
					teamId: "43953",
					plays: [
						{
							clock: "10:00",
							playText: "GOAL by CANISIUS Micah Hanson.",
							homeScore: 2,
							visitorScore: 1,
						},
					],
				},
			],
		},
	],
};

const box = {
	contestId: 6538796,
	status: "F",
	period: "FINAL",
	teams: pbp.teams,
	teamBoxscore: [
		{
			teamId: "43953",
			teamStats: { goals: 2, assists: 1, clears: 0, clearAttempts: 2 },
			playerStats: [
				{ firstName: "Quinn", lastName: "Huber", goals: 1, assists: 0 },
				{ firstName: "Micah", lastName: "Hanson", goals: 1, assists: 0 },
				{ firstName: "Carson", lastName: "Christy", goals: 0, assists: 1 },
				{ firstName: "Sam", lastName: "Kosloski", position: "G" },
			],
		},
		{
			teamId: "1388929",
			teamStats: { goals: 1, assists: 0 },
			playerStats: [
				{ firstName: "Jack", lastName: "Smith", goals: 1 },
				{ firstName: "Cole", lastName: "Gibstein" },
				{ firstName: "Noah", lastName: "Perea", position: "G" },
			],
		},
	],
};

describe("v1 normalize: game", () => {
	it("maps gamecenter contest to a V1Game and keeps unavailable fields null", () => {
		const g = normalizeGame({
			sport: "lacrosse-men",
			division: "d1",
			gamecenter,
		});
		expect(g.id).toBe("6538796");
		expect(g.date).toBe("2026-03-07");
		expect(g.status.state).toBe("final");
		expect(g.home.shortName).toBe("Canisius");
		expect(g.home.score).toBe(10);
		expect(g.away.score).toBe(5);
		expect(g.venue).toEqual({
			name: "Demske Sports Complex",
			city: "Buffalo",
			state: "NY",
		});
		expect(g.broadcast.network).toBeNull();
		expect(g.attendance).toBeNull();
		expect(g.startTime).toBe("TBA");
		expect(g.linescoreSource).toBe("ncaa");
		expect(linescoreAddsUp(g)).toBe(false);
	});

	it("keeps a previously PBP-repaired linescore when NCAA's still doesn't add up", () => {
		const first = normalizeGame({
			sport: "lacrosse-men",
			division: "d1",
			gamecenter,
		});
		const repaired = {
			...first,
			linescoreSource: "pbp" as const,
			linescore: [
				{ period: "1", home: 4, away: 0 },
				{ period: "2", home: 1, away: 4 },
				{ period: "3", home: 2, away: 1 },
				{ period: "4", home: 3, away: 0 },
			],
		};
		const again = normalizeGame({
			sport: "lacrosse-men",
			division: "d1",
			gamecenter,
			previous: repaired,
		});
		expect(again.linescoreSource).toBe("pbp");
		expect(again.linescore[0]).toEqual({ period: "1", home: 4, away: 0 });
	});

	it("normalizes state codes", () => {
		expect(normalizeState("F")).toBe("final");
		expect(normalizeState("I")).toBe("live");
		expect(normalizeState("live")).toBe("live");
		expect(normalizeState("P")).toBe("pre");
		expect(toInt("12")).toBe(12);
		expect(toInt("")).toBeNull();
		expect(toInt(null)).toBeNull();
	});
});

describe("v1 normalize: plays + linescore repair", () => {
	it("classifies and parses goal text", () => {
		expect(classifyPlay("GOAL by CANISIUS Quinn Huber.")).toBe("goal");
		expect(classifyPlay("Shot by IONA Jack Smith, SAVE Sam Kosloski")).toBe(
			"save",
		);
		expect(classifyPlay("Faceoff A vs B won by A")).toBe("faceoff");
		expect(classifyPlay("Clear attempt by IONA good.")).toBe("clear");
		const goal = parseGoal(
			"GOAL by CANISIUS Quinn Huber, Assist by Carson Christy, goal number 3 for season.",
		);
		expect(goal.scorer).toBe("Quinn Huber");
		expect(goal.assist).toBe("Carson Christy");
	});

	it("rebuilds period scoring from goal events", () => {
		const plays = normalizePlays("6538796", pbp);
		expect(plays.plays.length).toBe(9);
		const ls = linescoreFromPlays(plays.plays);
		expect(ls).toEqual([
			{ period: "1", home: 1, away: 1 },
			{ period: "2", home: 1, away: 0 },
			{ period: "3", home: 0, away: 0 },
			{ period: "4", home: 0, away: 0 },
		]);
	});
});

describe("v1 normalize: boxscore", () => {
	it("derives player faceoffs, saves and team clears from PBP and labels them", () => {
		const b = normalizeBoxscore("6538796", box, null, pbp);
		expect(b.derived).toEqual({ faceoffs: "pbp", saves: "pbp", clears: "pbp" });
		const hanson = b.players.find((p) => p.name === "Micah Hanson");
		expect(hanson?.faceoffsWon).toBe(1);
		expect(hanson?.faceoffsTaken).toBe(1);
		const gibstein = b.players.find((p) => p.name === "Cole Gibstein");
		expect(gibstein?.faceoffsWon).toBe(0);
		expect(gibstein?.faceoffsTaken).toBe(1);
		const kosloski = b.players.find((p) => p.name === "Sam Kosloski");
		expect(kosloski?.isGoalie).toBe(true);
		expect(kosloski?.saves).toBe(1);
		expect(kosloski?.goalsAllowed).toBe(1);
		const canisius = b.teamStats.find((t) => t.teamId === "43953");
		expect(canisius?.clears).toBe(1);
		expect(canisius?.clearAttempts).toBe(2);
		expect(canisius?.goals).toBe(2);
		expect(canisius?.saves).toBe(1);
	});

	it("reports nothing derived when there is no PBP", () => {
		const b = normalizeBoxscore("6538796", box, null, null);
		expect(b.derived).toEqual({
			faceoffs: "none",
			saves: "none",
			clears: "none",
		});
		const hanson = b.players.find((p) => p.name === "Micah Hanson");
		expect(hanson?.faceoffsWon).toBeNull();
		expect(b.teamStats[0]?.clears).toBe(0);
	});
});

describe("store (memory fallback)", () => {
	beforeEach(() => resetStore());

	it("round-trips games, lists by board and by live state, and stores details", async () => {
		const g = normalizeGame({
			sport: "lacrosse-men",
			division: "d1",
			gamecenter,
		});
		await upsertGame(g);
		await upsertGame({
			...g,
			id: "1",
			status: { ...g.status, state: "live" },
		});
		expect((await getGame("6538796"))?.game.home.score).toBe(10);
		expect((await listGames("lacrosse-men", "d1", "2026-03-07")).length).toBe(
			2,
		);
		expect((await listGames("lacrosse-men", "d3", "2026-03-07")).length).toBe(
			0,
		);
		expect((await listLiveGames()).map((s) => s.game.id)).toEqual(["1"]);

		const plays = normalizePlays("6538796", pbp);
		await upsertDetail("6538796", "plays", plays);
		const stored = await getDetail<typeof plays>("6538796", "plays");
		expect(stored?.data.plays.length).toBe(9);
		expect(stored?.updatedAt).toBe(plays.updatedAt);
	});

	it("sums final box scores into season team totals", async () => {
		const g = normalizeGame({
			sport: "lacrosse-men",
			division: "d1",
			gamecenter,
		});
		const line = (teamId: string, shots: number, saves: number) => ({
			teamId,
			shots,
			saves,
			causedTurnovers: 4,
			penalties: { count: 2, minutes: 3 },
		});
		await upsertGame(g);
		await upsertGame({ ...g, id: "2" });
		await upsertGame({ ...g, id: "3", status: { ...g.status, state: "live" } });
		const detail = (teamStats: ReturnType<typeof line>[]) => ({
			updatedAt: new Date().toISOString(),
			teamStats,
		});
		await upsertDetail(
			g.id,
			"boxscore",
			detail([line("43953", 30, 10), line("1388929", 20, 5)]),
		);
		await upsertDetail("2", "boxscore", detail([line("43953", 40, 12)]));
		await upsertDetail("3", "boxscore", detail([line("43953", 99, 99)]));

		const rows = await aggregateTeamTotals("lacrosse-men", "d1", "2026");
		const can = toSeasonStats(rows.find((r) => r.teamId === "43953")!);
		expect(can.shortName).toBe("Canisius");
		expect(can.games).toBe(2);
		expect(can.totals.shots).toBe(70);
		expect(can.totals.saves).toBe(22);
		expect(can.totals.penalties).toBe(4);
		expect(can.totals.penaltyMinutes).toBe(6);
		expect(can.perGame.shots).toBe(35);
		expect(can.perGame.saves).toBe(11);
		expect(can.perGame.causedTurnovers).toBe(4);
		expect(rows.find((r) => r.teamId === "1388929")?.games).toBe(1);
		expect(await aggregateTeamTotals("lacrosse-men", "d1", "2025")).toEqual([]);
	});
});

describe("poller scheduling", () => {
	it("polls yesterday too in the early morning ET", () => {
		expect(boardDates(new Date("2026-03-08T07:00:00Z"))).toEqual([
			"2026-03-07",
			"2026-03-08",
		]);
		expect(boardDates(new Date("2026-03-08T18:00:00Z"))).toEqual([
			"2026-03-08",
		]);
	});

	it("backs off when idle and out of season", () => {
		const spring = new Date("2026-03-08T18:00:00Z");
		const fall = new Date("2026-09-26T18:00:00Z");
		expect(inSeason(spring)).toBe(true);
		expect(inSeason(fall)).toBe(false);
		expect(nextIntervalMs(2, spring)).toBeLessThan(nextIntervalMs(0, spring));
		expect(nextIntervalMs(0, spring)).toBeLessThan(nextIntervalMs(0, fall));
	});
});
