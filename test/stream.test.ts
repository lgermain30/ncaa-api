import { beforeEach, describe, expect, it } from "bun:test";
import { resetStore, upsertGame } from "../src/store";
import {
	diffGame,
	eventsSince,
	publishDetails,
	publishGame,
	resetEvents,
	subscribe,
} from "../src/v1/events";
import { v1 } from "../src/v1/routes";
import type { V1Game } from "../src/v1/types";

function game(over: Partial<V1Game> = {}): V1Game {
	return {
		id: "1",
		sport: "lacrosse-men",
		division: "d1",
		date: "2026-03-07",
		startEpoch: 1772900000,
		startTime: "1:00 PM ET",
		status: {
			state: "live",
			period: "2",
			clock: "10:00",
			display: "2nd 10:00",
			finalMessage: "",
		},
		home: {
			id: "43953",
			name: "Canisius University",
			shortName: "Canisius",
			seoName: "canisius",
			char6: "CANISI",
			color: null,
			score: 3,
			rank: null,
			seed: null,
			record: null,
			conference: null,
			isWinner: false,
		},
		away: {
			id: "1388929",
			name: "Iona University",
			shortName: "Iona",
			seoName: "iona",
			char6: "IONA",
			color: null,
			score: 2,
			rank: null,
			seed: null,
			record: null,
			conference: null,
			isWinner: false,
		},
		linescore: [
			{ period: "1", home: 2, away: 1 },
			{ period: "2", home: 1, away: 1 },
		],
		linescoreSource: "ncaa",
		venue: null,
		broadcast: { network: null, liveVideo: false },
		attendance: null,
		bracket: null,
		links: { ncaa: null },
		detailed: true,
		updatedAt: new Date().toISOString(),
		...over,
	} as V1Game;
}

async function readUntil(
	res: Response,
	predicate: (text: string) => boolean,
	timeoutMs = 2000,
): Promise<string> {
	const reader = res.body?.getReader();
	if (!reader) throw new Error("no body");
	const decoder = new TextDecoder();
	let text = "";
	const deadline = Date.now() + timeoutMs;
	while (!predicate(text) && Date.now() < deadline) {
		const chunk = await Promise.race([
			reader.read(),
			new Promise<{ done: true; value: undefined }>((r) =>
				setTimeout(() => r({ done: true, value: undefined }), 200),
			),
		]);
		if (chunk.value) text += decoder.decode(chunk.value);
		if (chunk.done && chunk.value === undefined && predicate(text)) break;
	}
	await reader.cancel();
	return text;
}

describe("v1 events: diff", () => {
	beforeEach(() => {
		resetEvents();
	});

	it("first sight is game.new only", () => {
		const events = diffGame(null, game());
		expect(events.map((e) => e.type)).toEqual(["game.new"]);
	});

	it("emits score + clock + linescore when the home team scores", () => {
		const before = game();
		const after = game({
			home: { ...before.home, score: 4 },
			status: { ...before.status, clock: "8:12", display: "2nd 8:12" },
			linescore: [
				{ period: "1", home: 2, away: 1 },
				{ period: "2", home: 2, away: 1 },
			],
		});
		const events = diffGame(before, after);
		expect(events.map((e) => e.type)).toEqual(["game.score", "game.linescore"]);
		expect(events[0].scored).toEqual({ side: "home", by: 1 });
		expect(events[0].home.score).toBe(4);
	});

	it("emits game.clock alone when only the clock moves", () => {
		const before = game();
		const after = game({
			status: { ...before.status, clock: "9:00", display: "2nd 9:00" },
		});
		expect(diffGame(before, after).map((e) => e.type)).toEqual(["game.clock"]);
	});

	it("emits game.state (not clock) on live -> final", () => {
		const before = game();
		const after = game({
			status: {
				state: "final",
				period: "FINAL",
				clock: "",
				display: "Final",
				finalMessage: "FINAL",
			},
		});
		const events = diffGame(before, after);
		expect(events.map((e) => e.type)).toEqual(["game.state"]);
		expect(events[0].previousState).toBe("live");
	});

	it("nothing changes -> no events", () => {
		const g = game();
		expect(diffGame(g, game({ updatedAt: "2030-01-01T00:00:00Z" }))).toEqual(
			[],
		);
	});

	it("does not fire on a score correction downward", () => {
		const before = game();
		const after = game({ home: { ...before.home, score: 2 } });
		expect(diffGame(before, after).map((e) => e.type)).toEqual([]);
	});
});

describe("v1 events: bus + replay", () => {
	beforeEach(() => {
		resetEvents();
	});

	it("assigns increasing ids, fans out, and replays from Last-Event-ID with filters", () => {
		const seen: string[] = [];
		const off = subscribe((e) => seen.push(e.type));
		const g = game();
		const [first] = publishGame(null, g);
		publishGame(g, game({ home: { ...g.home, score: 4 } }));
		publishGame(
			null,
			game({ id: "2", sport: "lacrosse-women", division: "d3" }),
		);
		publishDetails(g, ["boxscore", "plays"]);
		off();
		publishGame(null, game({ id: "3" }));

		expect(first.id).toBe(1);
		expect(seen).toEqual([
			"game.new",
			"game.score",
			"game.new",
			"game.details",
		]);
		expect(eventsSince(1).map((e) => e.id)).toEqual([2, 3, 4, 5]);
		expect(
			eventsSince(0, { sport: "lacrosse-women" }).map((e) => e.gameId),
		).toEqual(["2"]);
		expect(eventsSince(0, { gameId: "1" }).map((e) => e.type)).toEqual([
			"game.new",
			"game.score",
			"game.details",
		]);
	});
});

describe("GET /v1/stream", () => {
	beforeEach(() => {
		delete Bun.env.NCAA_HEADER_KEY;
		resetStore();
		resetEvents();
	});

	it("is an SSE response that says hello with live games, then relays matching events", async () => {
		const live = game({ id: "990000001" });
		await upsertGame(live);
		await upsertGame(game({ id: "9", sport: "lacrosse-women" }));

		const res = await v1.handle(
			new Request("http://localhost/v1/stream?game=990000001"),
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toStartWith("text/event-stream");
		expect(res.headers.get("cache-control")).toContain("no-store");

		setTimeout(() => {
			publishGame(null, game({ id: "9", sport: "lacrosse-women" }));
			publishGame(live, game({ ...live, away: { ...live.away, score: 3 } }));
		}, 50);

		const text = await readUntil(res, (t) => t.includes("event: game.score"));
		expect(text).toContain("retry: 3000");
		expect(text).toContain("event: hello");
		const hello = JSON.parse(
			text.split("event: hello\ndata: ")[1].split("\n")[0],
		);
		expect(hello.live.map((g: V1Game) => g.id)).toEqual(["990000001"]);
		expect(text).not.toContain('"gameId":"9"');
		expect(text).toContain('"scored":{"side":"away","by":1}');
	});

	it("replays missed events from Last-Event-ID", async () => {
		const g = game({ id: "990000002" });
		const [created] = publishGame(null, g);
		const [scored] = publishGame(
			g,
			game({ ...g, home: { ...g.home, score: 4 } }),
		);
		const res = await v1.handle(
			new Request("http://localhost/v1/stream?game=990000002", {
				headers: { "Last-Event-ID": String(created.id) },
			}),
		);
		const text = await readUntil(res, (t) => t.includes(`id: ${scored.id}\n`));
		expect(text).toContain(`id: ${scored.id}\nevent: game.score`);
		expect(text).not.toContain(`id: ${created.id}\nevent: game.new`);
	});

	it("rejects an invalid filter", async () => {
		const res = await v1.handle(
			new Request("http://localhost/v1/stream?sport=hockey"),
		);
		expect(res.status).toBe(422);
	});
});
