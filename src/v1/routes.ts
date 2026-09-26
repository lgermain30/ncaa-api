import { Elysia } from "elysia";
import * as v from "valibot";
import { pollerStats } from "../poller";
import { UpstreamError } from "../upstream";
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
				"GET /v1/status                            poller / store health",
			],
		};
	})
	.get("/status", ({ set }) => {
		set.headers["Cache-Control"] = "no-store";
		return { poller: pollerStats, service: serviceStats, todayEt: todayEt() };
	})
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
	);
