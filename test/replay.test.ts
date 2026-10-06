import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resetStore, upsertDetail, upsertGame } from "../src/store";
import { resetEvents, subscribe } from "../src/v1/events";
import { normalizePlays } from "../src/v1/normalize";
import {
	boxscoreDisagrees,
	boxscoreFromPlays,
	boxscoreIsBlank,
	boxscoreIsEmpty,
	rosterFromPlays,
} from "../src/v1/pbpbox";
import {
	periodStartMs,
	playElapsedMs,
	QUARTER_MS,
	replayActive,
	replayBoard,
	replayBoxscore,
	replayGame,
	replayLive,
	replayPlays,
	replayStatus,
	replayTick,
	startReplay,
	stopReplay,
} from "../src/v1/replay";
import { getBoard, getGameById, getLive, getPlays } from "../src/v1/service";
import type { V1Boxscore, V1Game, V1Plays } from "../src/v1/types";
import boxscoreFixture from "./fixtures/replay/boxscore.json";
import gameFixture from "./fixtures/replay/game.json";
import playsFixture from "./fixtures/replay/plays.json";

const game = gameFixture as V1Game;
const plays = playsFixture as V1Plays;
const boxscore = boxscoreFixture as V1Boxscore;

async function seed() {
	await upsertGame(game);
	await upsertDetail(game.id, "plays", plays);
	await upsertDetail(game.id, "boxscore", boxscore);
}

describe("replay timeline", () => {
	it("maps period/clock to elapsed running time", () => {
		expect(playElapsedMs({ period: 1, clock: "15:00" })).toBe(0);
		expect(playElapsedMs({ period: 1, clock: "14:00" })).toBe(60_000);
		expect(playElapsedMs({ period: 2, clock: "15:00" })).toBe(periodStartMs(2));
		expect(periodStartMs(2)).toBe(QUARTER_MS + 2 * 60_000);
		expect(periodStartMs(3)).toBe(2 * QUARTER_MS + 12 * 60_000);
		expect(playElapsedMs({ period: 4, clock: "00:00" })).toBe(
			periodStartMs(4) + QUARTER_MS,
		);
		expect(playElapsedMs({ period: 5, clock: "" })).toBe(periodStartMs(5));
	});
});

describe("boxscoreFromPlays", () => {
	it("rebuilds the final box from the full play list", () => {
		const rebuilt = boxscoreFromPlays(
			boxscore,
			plays.plays,
			boxscore.status,
			boxscore.updatedAt,
		);
		const goals = (b: V1Boxscore) =>
			b.teamStats.map((t) => [t.teamId, t.goals]).sort();
		expect(goals(rebuilt)).toEqual(goals(boxscore));
		const miller = rebuilt.players.find((p) => p.name === "LUKE MILLER");
		const millerFinal = boxscore.players.find((p) => p.name === "LUKE MILLER");
		expect(miller?.goals).toBe(millerFinal?.goals ?? -1);
		expect(miller?.assists).toBe(millerFinal?.assists ?? -1);
		expect(miller?.shots).toBe(millerFinal?.shots ?? -1);
		const goalie = rebuilt.players.find((p) => p.name === "ORAN GELINAS");
		expect(goalie?.saves).toBe(9);
		expect(goalie?.goalsAllowed).toBe(
			boxscore.teamStats.find((t) => t.teamId === "43861")?.goals ?? -1,
		);
		expect(rebuilt.teamStats.every((t) => (t.faceoffsWon ?? 0) > 0)).toBe(true);
	});

	it("is empty before any play", () => {
		const b = boxscoreFromPlays(boxscore, [], boxscore.status, "x");
		expect(b.players.every((p) => p.goals === 0 && !p.played)).toBe(true);
		expect(b.teamStats.every((t) => t.shots === 0)).toBe(true);
	});
});

describe("replay run", () => {
	beforeEach(async () => {
		resetStore();
		resetEvents();
		await seed();
	});
	afterEach(() => {
		stopReplay();
		resetStore();
	});

	it("is invisible when off", async () => {
		expect(replayActive()).toBe(false);
		expect(replayBoard("lacrosse-men", "d1", game.date)).toBeNull();
		expect(replayGame(game.id)).toBeNull();
		expect(replayLive()).toEqual([]);
		const served = await getGameById(game.id);
		expect(served?.data.status.state).toBe("final");
		expect(served?.data.date).toBe(game.date);
		expect(replayStatus().active).toBe(false);
	});

	it("refuses a day with no stored play-by-play", async () => {
		await expect(
			startReplay({ date: "1999-01-01" }, ["lacrosse-men"], ["d1"]),
		).rejects.toThrow(/no stored games/);
		expect(replayActive()).toBe(false);
	});

	it("walks pre -> live -> final against a virtual clock", async () => {
		const t0 = Date.parse("2027-02-13T17:00:00Z");
		const status = await startReplay(
			{ date: game.date, leadSec: 60, speed: 1 },
			["lacrosse-men"],
			["d1"],
			t0,
		);
		expect(status.active).toBe(true);
		expect(status.games).toHaveLength(1);
		expect(status.games[0].state).toBe("pre");

		const pre = replayGame(game.id, t0) as V1Game;
		expect(pre.status.state).toBe("pre");
		expect(pre.startEpoch).toBe(Math.floor(t0 / 1000) + 60);
		expect(pre.date).toBe("2027-02-13");
		expect(pre.home.score).toBeNull();
		expect(replayBoard("lacrosse-men", "d1", "2027-02-13", t0)).toHaveLength(1);
		expect(replayBoard("lacrosse-men", "d1", game.date, t0)).toBeNull();
		expect(replayBoard("lacrosse-women", "d1", "2027-02-13", t0)).toBeNull();

		const tip = t0 + 60_000;
		const q1 = replayGame(game.id, tip + 30_000) as V1Game;
		expect(q1.status.state).toBe("live");
		expect(q1.status.period).toBe("1");
		expect(q1.status.clock).toBe("14:30");
		expect(q1.status.display).toBe("1st 14:30");
		expect(replayLive(tip + 30_000)).toHaveLength(1);

		// first goal: JHU at 06:43 of the 1st (8:17 elapsed)
		const beforeGoal = tip + 8 * 60_000 + 16_000;
		const afterGoal = tip + 8 * 60_000 + 18_000;
		expect((replayGame(game.id, beforeGoal) as V1Game).away.score).toBe(0);
		const g = replayGame(game.id, afterGoal) as V1Game;
		expect(g.away.score).toBe(1);
		expect(g.home.score).toBe(0);
		expect(g.linescore[0]).toEqual({ period: "1", away: 1, home: 0 });
		const released = replayPlays(game.id, afterGoal) as V1Plays;
		expect(released.plays.length).toBeGreaterThan(20);
		expect(released.plays.length).toBeLessThan(plays.plays.length);
		expect(released.plays.filter((p) => p.type === "goal")).toHaveLength(1);
		const box = replayBoxscore(game.id, afterGoal) as V1Boxscore;
		expect(box.status.state).toBe("live");
		expect(box.teamStats.find((t) => t.teamId === "43920")?.goals).toBe(1);

		const half = tip + periodStartMs(2) + QUARTER_MS + 60_000;
		expect((replayGame(game.id, half) as V1Game).status.display).toBe(
			"Halftime",
		);

		const done = tip + periodStartMs(4) + QUARTER_MS + 5_000;
		const fin = replayGame(game.id, done) as V1Game;
		expect(fin.status.state).toBe("final");
		expect(fin.home.score).toBe(game.home.score);
		expect(fin.away.score).toBe(game.away.score);
		expect(fin.date).toBe("2027-02-13");
		expect((replayPlays(game.id, done) as V1Plays).plays).toHaveLength(
			plays.plays.length,
		);
		expect(replayBoxscore(game.id, done)).toEqual(boxscore);
	});

	it("honours speed and publishes stream events on tick", async () => {
		const t0 = Date.parse("2027-02-13T17:00:00Z");
		await startReplay(
			{ date: game.date, leadSec: 10, speed: 60 },
			["lacrosse-men"],
			["d1"],
			t0,
		);
		const seen: string[] = [];
		const off = subscribe((e) => seen.push(e.type));
		// 10 real seconds of lead at 60x = ~0.17s; 1 real second in = 60 virtual s
		replayTick(t0 + 1_000);
		const g = replayGame(game.id, t0 + 1_000) as V1Game;
		expect(g.status.state).toBe("live");
		expect(g.status.clock).toBe("14:10");
		expect(seen).toContain("game.state");
		off();
	});

	it("overlays the service while active", async () => {
		const t0 = Date.now();
		await startReplay(
			{ date: game.date, leadSec: 0, speed: 1 },
			["lacrosse-men"],
			["d1"],
			t0 - 30_000,
		);
		const served = await getGameById(game.id);
		expect(served?.data.status.state).toBe("live");
		const live = await getLive();
		expect(live.data.map((g) => g.id)).toContain(game.id);
		const p = await getPlays(game.id);
		expect(p?.data.plays.length).toBeLessThan(plays.plays.length);
		const board = await getBoard("lacrosse-men", "d1", served?.data.date ?? "");
		expect(board.data[0].id).toBe(game.id);
		expect(board.data[0].status.state).toBe("live");

		stopReplay();
		const after = await getGameById(game.id);
		expect(after?.data.status.state).toBe("final");
		expect(after?.data.date).toBe(game.date);
		expect((await getLive()).data).toEqual([]);
	});
});

describe("empty NCAA box + duplicated PBP (older seasons)", () => {
	it("dedupes back-to-back repeated plays", () => {
		const play = (t: string, c = "15:00") => ({
			playText: t,
			clock: c,
			homeScore: "0",
			visitorScore: "0",
		});
		const raw = {
			periods: [
				{
					periodNumber: 1,
					playbyplayStats: [
						{
							teamId: 1,
							plays: [
								play("A at goalie for X."),
								play("A at goalie for X."),
								play("A at goalie for X."),
								play("Faceoff A vs B won by X", "14:59"),
								play("Faceoff A vs B won by X", "14:59"),
								play("Faceoff A vs B won by X", "14:30"),
							],
						},
					],
				},
			],
		};
		const out = normalizePlays("1", raw as never);
		expect(out.plays.map((p) => p.clock)).toEqual(["15:00", "14:59", "14:30"]);
	});

	it("dedupes plays repeated non-adjacently within a period (2022 feeds)", () => {
		const play = (t: string, c: string, h = "0", v = "0") => ({
			playText: t,
			clock: c,
			homeScore: h,
			visitorScore: v,
		});
		const run = [
			play("GOAL by A X.", "13:43", "1", "0"),
			play("Shot by A Y WIDE", "12:00", "1", "0"),
			play("GOAL by A Z.", "08:40", "2", "0"),
		];
		const raw = {
			periods: [
				{
					periodNumber: 1,
					playbyplayStats: [{ teamId: 1, plays: [...run, ...run] }],
				},
				{
					periodNumber: 2,
					playbyplayStats: [
						{ teamId: 1, plays: [play("GOAL by A X.", "13:43", "3", "0")] },
					],
				},
			],
		};
		const out = normalizePlays("1", raw as never);
		expect(out.plays.filter((p) => p.type === "goal")).toHaveLength(3);
		expect(out.plays).toHaveLength(4);
	});

	it("dedupes repeats that only differ by team abbreviation, entities or assist", () => {
		const play = (t: string, c: string, h: string, v: string) => ({
			playText: t,
			clock: c,
			homeScore: h,
			visitorScore: v,
		});
		const raw = {
			periods: [
				{
					periodNumber: 1,
					playbyplayStats: [
						{
							teamId: 1,
							plays: [
								play(
									"GOAL by SACREDHEART Morgan O&#39;Reilly, Assist by A.",
									"04:09",
									"1",
									"0",
								),
								play(
									"GOAL by SACREDH Morgan O'Reilly, Assist by B.",
									"04:09",
									"1",
									"0",
								),
								play("Shot by SACREDHEART Jake Garb WIDE", "03:00", "1", "0"),
								play("Shot by SACREDH Jake Garb WIDE", "03:00", "1", "0"),
								play("Shot by SACREDH Sal Miccio WIDE", "03:00", "1", "0"),
								play("GOAL by SACREDH Jake Garb.", "01:00", "2", "0"),
							],
						},
					],
				},
			],
		};
		const out = normalizePlays("1", raw as never);
		expect(out.plays.filter((p) => p.type === "goal")).toHaveLength(2);
		expect(out.plays.filter((p) => p.type === "shot")).toHaveLength(2);
	});

	it("flags a final whose box disagrees with the score the PBP confirms", () => {
		const game = {
			status: { state: "final" },
			home: { id: "H", score: 2 },
			away: { id: "A", score: 1 },
		};
		const plays = [
			{ type: "goal", teamId: "H" },
			{ type: "goal", teamId: "H" },
			{ type: "goal", teamId: "A" },
		] as never;
		const box = (hGoals: number, aGoals: number) =>
			({
				teamStats: [
					{ teamId: "H", goals: hGoals },
					{ teamId: "A", goals: aGoals },
				],
				players: [
					{ teamId: "H", goals: hGoals },
					{ teamId: "A", goals: aGoals },
				],
			}) as never;
		expect(boxscoreDisagrees(box(2, 1), plays, game as never)).toBe(false);
		expect(boxscoreDisagrees(box(4, 2), plays, game as never)).toBe(true);
		expect(boxscoreDisagrees(box(1, 0), plays, game as never)).toBe(true);
		expect(
			boxscoreDisagrees(box(4, 2), plays, {
				...game,
				status: { state: "live" },
			} as never),
		).toBe(false);
	});

	it("synthesizes player lines from the PBP when NCAA published none", () => {
		const empty: V1Boxscore = { ...boxscore, players: [] };
		const roster = rosterFromPlays(empty, plays.plays);
		expect(roster.length).toBeGreaterThan(0);
		for (const t of empty.teams) {
			expect(roster.some((p) => p.teamId === t.teamId)).toBe(true);
		}
		const rebuilt = boxscoreFromPlays(
			{ ...empty, players: roster },
			plays.plays,
			empty.status,
			"x",
			true,
		);
		for (const t of rebuilt.teamStats) {
			const orig = boxscore.teamStats.find((x) => x.teamId === t.teamId);
			expect(t.goals).toBe(orig?.goals ?? -1);
		}
		expect(boxscoreIsBlank(empty)).toBe(false);
		expect(
			boxscoreIsBlank({
				...empty,
				teamStats: empty.teamStats.map((t) => ({
					...t,
					goals: 0,
					shots: 0,
					groundBalls: 0,
					turnovers: 0,
				})),
			}),
		).toBe(true);
	});

	it("treats a roster-only box with all-zero lines as blank", () => {
		const rosterOnly: V1Boxscore = {
			...boxscore,
			teamStats: boxscore.teamStats.map((t) => ({
				...t,
				goals: 0,
				shots: 0,
				groundBalls: 0,
				turnovers: 0,
			})),
			players: boxscore.players.map((p) => ({
				...p,
				goals: 0,
				assists: 0,
				shots: 0,
				groundBalls: 0,
				saves: null,
			})),
		};
		expect(rosterOnly.players.length).toBeGreaterThan(0);
		expect(boxscoreIsBlank(rosterOnly)).toBe(true);
		expect(boxscoreIsBlank(boxscore)).toBe(false);
	});

	it("rebuilds an all-zero box from the play-by-play", () => {
		const zero: V1Boxscore = {
			...boxscore,
			teamStats: boxscore.teamStats.map((t) => ({
				...t,
				goals: 0,
				shots: 0,
				groundBalls: 0,
				turnovers: 0,
				saves: null,
				faceoffsWon: null,
				faceoffsLost: null,
				clears: null,
				penalties: null,
			})),
			players: boxscore.players.map((p) => ({
				...p,
				goals: 0,
				assists: 0,
				shots: 0,
				groundBalls: 0,
				saves: null,
				faceoffsWon: null,
				faceoffsTaken: null,
				isGoalie: false,
				penalties: null,
				position: "",
				played: false,
			})),
		};
		expect(boxscoreIsEmpty(zero, plays.plays)).toBe(true);
		expect(boxscoreIsEmpty(boxscore, plays.plays)).toBe(false);
		const fixed = boxscoreFromPlays(zero, plays.plays, zero.status, "x", true);
		const jhu = fixed.teamStats.find((t) => t.teamId === "43920");
		expect(jhu?.goals).toBe(
			boxscore.teamStats.find((t) => t.teamId === "43920")?.goals ?? -1,
		);
		expect((jhu?.faceoffsWon ?? 0) + (jhu?.faceoffsLost ?? 0)).toBeGreaterThan(
			15,
		);
		expect(jhu?.saves).toBe(9);
		expect(jhu?.penalties?.count ?? 0).toBeGreaterThan(0);
		const gelinas = fixed.players.find((p) => p.name === "ORAN GELINAS");
		expect(gelinas?.isGoalie).toBe(true);
		expect(gelinas?.saves).toBe(9);
		expect(gelinas?.played).toBe(true);
		expect(fixed.derived.faceoffs).toBe("pbp");
		expect(fixed.derived.groundBalls).toBe("pbp");
	});
});
