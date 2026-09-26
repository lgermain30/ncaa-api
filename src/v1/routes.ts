import { Elysia } from "elysia";
import * as v from "valibot";
import { pollerStats } from "../poller";
import { UpstreamError } from "../upstream";
import { backfillProgress, startBackfill, stopBackfill } from "./backfill";
import {
	eventStats,
	eventsSince,
	type GameEvent,
	lastEventId,
	matches,
	matchesGame,
	type StreamFilter,
	subscribe,
} from "./events";
import {
	getBoard,
	getBoxscore,
	getGameById,
	getLive,
	getPlays,
	LACROSSE_DIVISIONS,
	LACROSSE_SPORTS,
	type Served,
	serviceStats,
	todayEt,
} from "./service";
import { getTeam, getTeams, lookupTeam } from "./teams";

/*
 * /v1 — the normalized, versioned API shared by collegelacrossenews.com and
 * the mobile app. Every response is
 *
 *   { data, meta: { updatedAt, stale } }
 *
 * with an ETag (304 on If-None-Match), short public Cache-Control tuned to the
 * game state, and the same X-CLN-Stale headers as the legacy routes when NCAA
 * is unreachable and we serve the stored copy.
 */

const sportParam = v.picklist([...LACROSSE_SPORTS]);
const divisionParam = v.picklist([...LACROSSE_DIVISIONS]);
const dateParam = v.pipe(
	v.string(),
	v.regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
);
const idParam = v.pipe(v.string(), v.regex(/^\d+$/, "id must be numeric"));

/** Key-order-independent serialization: Postgres jsonb reorders object keys. */
function canonical(v: unknown): string {
	if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
	if (v && typeof v === "object") {
		const o = v as Record<string, unknown>;
		return `{${Object.keys(o)
			.sort()
			.map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
			.join(",")}}`;
	}
	return JSON.stringify(v) ?? "null";
}

function etagFor(payload: unknown): string {
	return `W/"${Bun.hash(canonical(payload)).toString(16)}"`;
}

function maxAgeFor(payload: unknown): number {
	const games = Array.isArray(payload) ? payload : [payload];
	const live = games.some(
		(g) =>
			g &&
			typeof g === "object" &&
			"status" in g &&
			(g as { status?: { state?: string } }).status?.state === "live",
	);
	return live ? 10 : 60;
}

interface Ctx {
	request: Request;
	set: { status?: number | string; headers: Record<string, string | number> };
}

function respond<T>(
	{ request, set }: Ctx,
	served: Served<T>,
): string | Response {
	const payload = {
		data: served.data,
		meta: { updatedAt: served.updatedAt, stale: served.stale },
	};
	const body = JSON.stringify(payload);
	const etag = etagFor(payload);
	set.headers.ETag = etag;
	set.headers["Content-Type"] = "application/json";
	set.headers["Cache-Control"] =
		`public, max-age=${maxAgeFor(served.data)}, stale-while-revalidate=30`;
	set.headers.Vary = "Accept-Encoding";
	set.headers["X-CLN-Generated-At"] = new Date().toISOString();
	if (served.stale) {
		set.headers["X-CLN-Stale"] = "true";
		set.headers["X-CLN-Data-Age"] = String(
			Math.max(
				0,
				Math.round((Date.now() - Date.parse(served.updatedAt)) / 1000),
			),
		);
		set.headers.Warning = '110 - "Response is Stale"';
	}
	if (request.headers.get("if-none-match") === etag) {
		const headers = new Headers();
		for (const [k, val] of Object.entries(set.headers))
			headers.set(k, String(val));
		headers.delete("Content-Type");
		return new Response(null, { status: 304, headers });
	}
	return body;
}

const HEARTBEAT_MS = Number(process.env.STREAM_HEARTBEAT_MS) || 15_000;

function sseFrame(event: GameEvent): string {
	return `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * Server-Sent Events feed of game changes. Optional filters narrow it to one
 * board or game; Last-Event-ID (header or ?lastEventId=) replays anything the
 * client missed while reconnecting. Sends a `hello` frame with the current
 * live games first, then a comment heartbeat every HEARTBEAT_MS so proxies
 * keep the connection open.
 */
async function stream(
	request: Request,
	filter: StreamFilter,
): Promise<Response> {
	const encoder = new TextEncoder();
	const lastIdRaw =
		request.headers.get("last-event-id") ??
		new URL(request.url).searchParams.get("lastEventId");
	const lastId =
		lastIdRaw && /^\d+$/.test(lastIdRaw) ? Number(lastIdRaw) : null;
	const live = await getLive();

	let unsubscribe: (() => void) | null = null;
	let heartbeat: ReturnType<typeof setInterval> | null = null;
	const cleanup = () => {
		unsubscribe?.();
		unsubscribe = null;
		if (heartbeat) clearInterval(heartbeat);
		heartbeat = null;
	};

	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			const send = (text: string) => {
				try {
					controller.enqueue(encoder.encode(text));
				} catch {
					cleanup();
				}
			};
			send("retry: 3000\n\n");
			send(
				`event: hello\ndata: ${JSON.stringify({
					filter,
					lastEventId: lastEventId(),
					live: live.data.filter((g) => matchesGame(g, filter)),
					heartbeatMs: HEARTBEAT_MS,
				})}\n\n`,
			);
			if (lastId !== null) {
				for (const e of eventsSince(lastId, filter)) send(sseFrame(e));
			}
			unsubscribe = subscribe((e) => {
				if (matches(e, filter)) send(sseFrame(e));
			});
			heartbeat = setInterval(
				() => send(`: ping ${Date.now()}\n\n`),
				HEARTBEAT_MS,
			);
		},
		cancel() {
			cleanup();
		},
	});
	request.signal.addEventListener("abort", cleanup);

	return new Response(body, {
		status: 200,
		headers: {
			"Content-Type": "text/event-stream; charset=utf-8",
			"Cache-Control": "no-cache, no-store, no-transform",
			Connection: "keep-alive",
			"X-Accel-Buffering": "no",
		},
	});
}

/** Admin routes need ADMIN_KEY set on the server and sent as x-admin-key. */
function adminAuthorized(request: Request) {
	const key = process.env.ADMIN_KEY;
	return Boolean(key) && request.headers.get("x-admin-key") === key;
}

function forbidden(set: Ctx["set"]) {
	set.status = 403;
	set.headers["Cache-Control"] = "no-store";
	return { error: "forbidden" };
}

function notFound(set: Ctx["set"], what: string) {
	set.status = 404;
	set.headers["Content-Type"] = "application/json";
	set.headers["Cache-Control"] = "public, max-age=30";
	return JSON.stringify({ error: `${what} not found` });
}

export const v1 = new Elysia({ prefix: "/v1" })
	.onError(({ code, error, set }) => {
		if (code === "NOT_FOUND" || code === "VALIDATION") return;
		if (error instanceof UpstreamError) {
			set.status = 502;
			return {
				error: "Upstream data source unavailable",
				upstreamStatus: error.status ?? null,
			};
		}
	})
	.onBeforeHandle(({ request, status }) => {
		if (
			process.env.NCAA_HEADER_KEY &&
			request.headers.get("x-ncaa-key") !== process.env.NCAA_HEADER_KEY
		) {
			return status(401);
		}
	})
	.get("/", ({ set }) => {
		set.headers["Cache-Control"] = "public, max-age=3600";
		return {
			version: 1,
			sports: LACROSSE_SPORTS,
			divisions: LACROSSE_DIVISIONS,
			routes: [
				"GET /v1/games/:sport/:division            today's games (ET)",
				"GET /v1/games/:sport/:division/:date      games for YYYY-MM-DD",
				"GET /v1/live                              all live lacrosse games",
				"GET /v1/game/:id                          game header: teams, status, linescore, venue, broadcast, attendance",
				"GET /v1/game/:id/boxscore                 team + player lines (goals, assists, shots, GB, TO, CT, faceoffs, saves)",
				"GET /v1/game/:id/plays                    play-by-play, typed",
				"GET /v1/stream                            SSE: game.new/state/score/clock/linescore/details events; ?sport=&division=&date=&game= filters",
				"GET /v1/status                            poller / store health",
			],
		};
	})
	.get("/status", ({ set }) => {
		set.headers["Cache-Control"] = "no-store";
		return {
			poller: pollerStats,
			service: serviceStats,
			stream: { ...eventStats, lastEventId: lastEventId() },
			backfill: backfillProgress,
			todayEt: todayEt(),
		};
	})
	.post(
		"/admin/backfill",
		({ request, body, set }) => {
			if (!adminAuthorized(request)) return forbidden(set);
			set.headers["Cache-Control"] = "no-store";
			if (backfillProgress.running) {
				set.status = 409;
				return {
					error: "backfill already running",
					backfill: backfillProgress,
				};
			}
			set.status = 202;
			return { backfill: startBackfill(body) };
		},
		{
			body: v.object({
				fromSeason: v.pipe(v.number(), v.integer(), v.minValue(2000)),
				toSeason: v.pipe(v.number(), v.integer(), v.minValue(2000)),
				from: v.optional(v.pipe(v.string(), v.regex(/^\d{2}-\d{2}$/))),
				to: v.optional(v.pipe(v.string(), v.regex(/^\d{2}-\d{2}$/))),
				sports: v.optional(v.array(sportParam)),
				divisions: v.optional(v.array(divisionParam)),
				details: v.optional(v.boolean()),
				skipStored: v.optional(v.boolean()),
			}),
		},
	)
	.delete("/admin/backfill", ({ request, set }) => {
		if (!adminAuthorized(request)) return forbidden(set);
		set.headers["Cache-Control"] = "no-store";
		return { backfill: stopBackfill() };
	})
	.get(
		"/stream",
		({ request, query }) =>
			stream(request, {
				sport: query.sport,
				division: query.division,
				date: query.date,
				gameId: query.game,
			}),
		{
			query: v.object({
				sport: v.optional(sportParam),
				division: v.optional(divisionParam),
				date: v.optional(dateParam),
				game: v.optional(idParam),
			}),
		},
	)
	.get(
		"/games/:sport/:division",
		async (ctx) =>
			respond(
				ctx,
				await getBoard(ctx.params.sport, ctx.params.division, todayEt()),
			),
		{ params: v.object({ sport: sportParam, division: divisionParam }) },
	)
	.get(
		"/games/:sport/:division/:date",
		async (ctx) =>
			respond(
				ctx,
				await getBoard(ctx.params.sport, ctx.params.division, ctx.params.date),
			),
		{
			params: v.object({
				sport: sportParam,
				division: divisionParam,
				date: dateParam,
			}),
		},
	)
	.get("/live", async (ctx) => respond(ctx, await getLive()))
	.get(
		"/game/:id",
		async (ctx) => {
			const served = await getGameById(ctx.params.id);
			return served ? respond(ctx, served) : notFound(ctx.set, "game");
		},
		{ params: v.object({ id: idParam }) },
	)
	.get(
		"/game/:id/boxscore",
		async (ctx) => {
			const served = await getBoxscore(ctx.params.id);
			return served ? respond(ctx, served) : notFound(ctx.set, "boxscore");
		},
		{ params: v.object({ id: idParam }) },
	)
	.get(
		"/game/:id/plays",
		async (ctx) => {
			const served = await getPlays(ctx.params.id);
			return served ? respond(ctx, served) : notFound(ctx.set, "play-by-play");
		},
		{ params: v.object({ id: idParam }) },
	)
	.get(
		"/teams/:sport/:division",
		async (ctx) =>
			respond(ctx, await getTeams(ctx.params.sport, ctx.params.division)),
		{ params: v.object({ sport: sportParam, division: divisionParam }) },
	)
	.get(
		"/teams/:sport/:division/:id",
		async (ctx) => {
			const { sport, division } = ctx.params;
			const id = await lookupTeam(sport, division, ctx.params.id);
			if (!id) return notFound(ctx.set, "team");
			const served = await getTeam(sport, division, id, ctx.query.season);
			return served.data
				? respond(ctx, served)
				: notFound(ctx.set, "team season");
		},
		{
			params: v.object({
				sport: sportParam,
				division: divisionParam,
				id: v.pipe(v.string(), v.minLength(1), v.maxLength(80)),
			}),
			query: v.object({
				season: v.optional(
					v.pipe(v.string(), v.regex(/^\d{4}$/, "season must be YYYY")),
				),
			}),
		},
	);
