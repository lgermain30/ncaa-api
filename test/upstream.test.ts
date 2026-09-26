import { afterEach, describe, expect, it, mock } from "bun:test";
import { fetchGameDetails } from "../src/gamecenter";
import { UpstreamError, upstreamFetch, upstreamStats } from "../src/upstream";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("upstreamFetch", () => {
  it("retries on 5xx then succeeds", async () => {
    let calls = 0;
    globalThis.fetch = mock(async () => {
      calls++;
      return calls < 2 ? new Response("boom", { status: 503 }) : new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    const res = await upstreamFetch("https://example.test/x", { retries: 2 });
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
  });

  it("throws UpstreamError with status after exhausting retries", async () => {
    globalThis.fetch = mock(async () => new Response("rate limited", { status: 429 })) as unknown as typeof fetch;
    const before = upstreamStats.failures;
    await expect(upstreamFetch("https://example.test/y", { retries: 1 })).rejects.toBeInstanceOf(UpstreamError);
    expect(upstreamStats.failures).toBe(before + 1);
    expect(upstreamStats.consecutiveFailures).toBeGreaterThan(0);
  });

  it("does not retry 404 and resets the failure streak on success", async () => {
    let calls = 0;
    globalThis.fetch = mock(async () => {
      calls++;
      return new Response("nope", { status: 404 });
    }) as unknown as typeof fetch;
    const res = await upstreamFetch("https://example.test/z", { retries: 3 });
    expect(res.status).toBe(404);
    expect(calls).toBe(1);
    expect(upstreamStats.consecutiveFailures).toBe(0);
  });

  it("aborts on timeout", async () => {
    globalThis.fetch = mock(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        })
    ) as unknown as typeof fetch;
    await expect(upstreamFetch("https://example.test/slow", { timeoutMs: 20, retries: 0 })).rejects.toBeInstanceOf(
      UpstreamError
    );
  });
});

describe("fetchGameDetails", () => {
  it("flattens gamecenter location, network and linescores", async () => {
    globalThis.fetch = mock(async () =>
      Response.json({
        data: {
          contests: [
            {
              id: "1",
              network: "ESPN",
              linescores: [{ period: "1", home: 3, visit: 2 }],
              location: { venue: "Scott Stadium", city: "Charlottesville", stateUsps: "VA" },
            },
          ],
        },
      })
    ) as unknown as typeof fetch;

    const details = await fetchGameDetails("1000001");
    expect(details.venue).toBe("Scott Stadium");
    expect(details.city).toBe("Charlottesville");
    expect(details.state).toBe("VA");
    expect(details.network).toBe("ESPN");
    expect(details.linescores).toEqual([{ period: "1", home: "3", visit: "2" }]);
  });

  it("returns empty details when upstream fails", async () => {
    globalThis.fetch = mock(async () => new Response("", { status: 500 })) as unknown as typeof fetch;
    const details = await fetchGameDetails("1000002");
    expect(details.linescores).toEqual([]);
    expect(details.venue).toBe("");
  });
});
