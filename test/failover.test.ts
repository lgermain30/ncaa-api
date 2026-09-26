import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { TieredCache } from "../src/cache";
import { app, cache_45s as cache45 } from "../src/index";
import {
	breakerState,
	resetBreakers,
	UpstreamError,
	upstreamFetch,
} from "../src/upstream";

const realFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = realFetch;
});

describe("TieredCache (memory mode)", () => {
	it("keeps a last-good copy after the fresh TTL expires", async () => {
		const cache = new TieredCache("test", 10);
		cache.set("k", { a: 1 });
		expect(cache.has("k")).toBe(true);
		await Bun.sleep(30);
		expect(cache.has("k")).toBe(false);
		const stale = await cache.getStale("k");
		expect(stale?.value).toEqual({ a: 1 });
		expect(stale?.ageSeconds).toBeGreaterThanOrEqual(0);
	});

	it("returns null when nothing was ever stored", async () => {
		const cache = new TieredCache("test2", 10);
		expect(await cache.getStale("missing")).toBeNull();
		expect(await cache.getShared("missing")).toBeUndefined();
	});
});

describe("circuit breaker", () => {
	beforeEach(() => resetBreakers());

	it("opens after repeated failures and fails fast without calling fetch", async () => {
		let calls = 0;
		globalThis.fetch = mock(async () => {
			calls++;
			return new Response("down", { status: 503 });
		}) as unknown as typeof fetch;

		const url = "https://breaker.test/resource";
		for (let i = 0; i < 5; i++) {
			await expect(upstreamFetch(url, { retries: 0 })).rejects.toBeInstanceOf(
				UpstreamError,
			);
		}
		expect(breakerState("breaker.test")).toBe("open");

		const before = calls;
		const err = await upstreamFetch(url, { retries: 0 }).catch(
			(e) => e as UpstreamError,
		);
		expect(err).toBeInstanceOf(UpstreamError);
		expect((err as UpstreamError).circuitOpen).toBe(true);
		expect(calls).toBe(before);
	});
});

describe("stale failover on routes", () => {
	beforeEach(() => resetBreakers());

	const gameId = "7000001";
	const scoringSummary = { periods: [{ period: 1, plays: [] }] };

	it("serves last-known-good data with stale headers when upstream fails", async () => {
		globalThis.fetch = mock(async () =>
			Response.json({ data: { scoringSummary } }),
		) as unknown as typeof fetch;

		const ok = await app.handle(
			new Request(`http://localhost/game/${gameId}/scoring-summary`),
		);
		expect(ok.status).toBe(200);
		expect(ok.headers.get("X-CLN-Stale")).toBeNull();
		expect(await ok.json()).toEqual(scoringSummary);

		// drop the fresh copy so the route re-fetches, then break upstream
		globalThis.fetch = mock(
			async () => new Response("down", { status: 503 }),
		) as unknown as typeof fetch;

		const key = `/game/${gameId}/scoring-summary?page=&season=`;
		expect(cache45.has(key)).toBe(true);
		cache45.evict(key);
		expect(cache45.has(key)).toBe(false);

		const stale = await app.handle(
			new Request(`http://localhost/game/${gameId}/scoring-summary`),
		);
		expect(stale.status).toBe(200);
		expect(stale.headers.get("X-CLN-Stale")).toBe("true");
		expect(Number(stale.headers.get("X-CLN-Data-Age"))).toBeGreaterThanOrEqual(
			0,
		);
		expect(await stale.json()).toEqual(scoringSummary);
	});

	it("returns 502 when upstream fails and nothing was ever cached", async () => {
		globalThis.fetch = mock(
			async () => new Response("down", { status: 503 }),
		) as unknown as typeof fetch;
		const res = await app.handle(
			new Request("http://localhost/game/7000002/scoring-summary"),
		);
		expect(res.status).toBe(502);
		expect(res.headers.get("X-CLN-Stale")).toBeNull();
	});
});
