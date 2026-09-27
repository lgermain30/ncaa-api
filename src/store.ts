import { SQL } from "bun";
import type { V1Game } from "./v1/types";

/**
 * Durable game state. Postgres when DATABASE_URL is set (Railway), otherwise
 * an in-process Map so dev/test and a fresh deploy work with no database.
 *
 *   games         one row per contest: normalized V1Game + sport/division/date
 *   game_details  (game_id, kind) -> jsonb   kind = boxscore | plays
 *   news_posts    CLN WordPress posts pushed by the cln-teams plugin
 */

export type DetailKind = "boxscore" | "plays";

export interface StoredGame {
	game: V1Game;
	updatedAt: string;
}

export interface StoredDetail<T = unknown> {
	data: T;
	updatedAt: string;
}

export const storeStats = {
	backend: "memory" as "memory" | "postgres",
	ready: false,
	errors: 0,
	lastError: null as string | null,
	writes: 0,
};

const memGames = new Map<string, { game: V1Game; updatedAt: string }>();
const memDetails = new Map<string, StoredDetail>();
const memNews = new Map<number, StoredNewsPost>();

export interface StoredNewsPost {
	id: number;
	publishedAt: string;
	data: unknown;
}

let sql: SQL | null = null;
let ready: Promise<void> | null = null;

function recordError(err: unknown) {
	storeStats.errors++;
	storeStats.lastError = err instanceof Error ? err.message : String(err);
}

const SCHEMA = [
	`CREATE TABLE IF NOT EXISTS games (
		id text PRIMARY KEY,
		sport text NOT NULL,
		division text NOT NULL,
		game_date date NOT NULL,
		state text NOT NULL,
		data jsonb NOT NULL,
		updated_at timestamptz NOT NULL DEFAULT now()
	)`,
	`CREATE INDEX IF NOT EXISTS games_sport_division_date_idx ON games (sport, division, game_date)`,
	`CREATE INDEX IF NOT EXISTS games_state_idx ON games (state) WHERE state = 'live'`,
	`CREATE TABLE IF NOT EXISTS game_details (
		game_id text NOT NULL,
		kind text NOT NULL,
		data jsonb NOT NULL,
		updated_at timestamptz NOT NULL DEFAULT now(),
		PRIMARY KEY (game_id, kind)
	)`,
	`CREATE TABLE IF NOT EXISTS news_posts (
		id integer PRIMARY KEY,
		published_at timestamptz NOT NULL,
		data jsonb NOT NULL,
		updated_at timestamptz NOT NULL DEFAULT now()
	)`,
	`CREATE INDEX IF NOT EXISTS news_posts_published_idx ON news_posts (published_at DESC)`,
];

/** Connects and applies the schema once; safe to call repeatedly. */
export function initStore(): Promise<void> {
	if (ready) return ready;
	const url = process.env.DATABASE_URL;
	if (!url) {
		storeStats.ready = true;
		ready = Promise.resolve();
		return ready;
	}
	storeStats.backend = "postgres";
	sql = new SQL(url);
	const client = sql;
	ready = (async () => {
		try {
			for (const stmt of SCHEMA) {
				await client.unsafe(stmt);
			}
			storeStats.ready = true;
		} catch (err) {
			recordError(err);
			// Keep serving from memory rather than crash the API.
			sql = null;
			storeStats.backend = "memory";
			storeStats.ready = true;
		}
	})();
	return ready;
}

/** Test hook: drop any connection and forget memory state. */
export function resetStore() {
	memGames.clear();
	memDetails.clear();
	memNews.clear();
	sql = null;
	ready = null;
	storeStats.backend = "memory";
	storeStats.ready = false;
}

export async function upsertGame(game: V1Game): Promise<void> {
	await initStore();
	const updatedAt = new Date().toISOString();
	storeStats.writes++;
	if (!sql) {
		memGames.set(game.id, { game, updatedAt });
		return;
	}
	try {
		await sql`
			INSERT INTO games (id, sport, division, game_date, state, data, updated_at)
			VALUES (${game.id}, ${game.sport}, ${game.division}, ${game.date}, ${game.status.state}, ${JSON.stringify(game)}::text::jsonb, ${updatedAt})
			ON CONFLICT (id) DO UPDATE SET
				sport = EXCLUDED.sport,
				division = EXCLUDED.division,
				game_date = EXCLUDED.game_date,
				state = EXCLUDED.state,
				data = EXCLUDED.data,
				updated_at = EXCLUDED.updated_at`;
	} catch (err) {
		recordError(err);
	}
}

export async function upsertGames(games: V1Game[]): Promise<void> {
	for (const g of games) {
		await upsertGame(g);
	}
}

interface GameRow {
	data: V1Game;
	updated_at: string | Date;
}

/** Bun's SQL returns jsonb as text on some drivers; accept both. */
function parseJson<T>(v: T | string): T {
	return typeof v === "string" ? (JSON.parse(v) as T) : v;
}

function rowToStored(row: GameRow): StoredGame {
	return {
		game: parseJson(row.data),
		updatedAt: new Date(row.updated_at).toISOString(),
	};
}

export async function getGame(id: string): Promise<StoredGame | null> {
	await initStore();
	if (sql) {
		try {
			const rows = await sql<
				GameRow[]
			>`SELECT data, updated_at FROM games WHERE id = ${id}`;
			if (rows[0]) return rowToStored(rows[0]);
		} catch (err) {
			recordError(err);
		}
	}
	return memGames.get(id) ?? null;
}

export async function listGames(
	sport: string,
	division: string,
	date: string,
): Promise<StoredGame[]> {
	await initStore();
	if (sql) {
		try {
			const rows = await sql<GameRow[]>`
				SELECT data, updated_at FROM games
				WHERE sport = ${sport} AND division = ${division} AND game_date = ${date}
				ORDER BY (data->>'startEpoch')::bigint NULLS LAST, id`;
			return rows.map(rowToStored);
		} catch (err) {
			recordError(err);
		}
	}
	return [...memGames.values()]
		.filter(
			(g) =>
				g.game.sport === sport &&
				g.game.division === division &&
				g.game.date === date,
		)
		.sort((a, b) => (a.game.startEpoch ?? 0) - (b.game.startEpoch ?? 0));
}

export async function listLiveGames(): Promise<StoredGame[]> {
	await initStore();
	if (sql) {
		try {
			const rows = await sql<GameRow[]>`
				SELECT data, updated_at FROM games WHERE state = 'live'
				ORDER BY sport, division, (data->>'startEpoch')::bigint NULLS LAST`;
			return rows.map(rowToStored);
		} catch (err) {
			recordError(err);
		}
	}
	return [...memGames.values()].filter((g) => g.game.status.state === "live");
}

export interface StoredTeamIdentity {
	seoName: string;
	name: string;
	shortName: string;
}

/** Distinct NCAA team identities seen on a board in a season (for logo/name lookups). */
export async function listBoardTeams(
	sport: string,
	division: string,
	season: string,
): Promise<StoredTeamIdentity[]> {
	await initStore();
	const from = `${season}-01-01`;
	const to = `${season}-12-31`;
	if (sql) {
		try {
			const rows = await sql<StoredTeamIdentity[]>`
				SELECT DISTINCT ON (t->>'seoName')
					t->>'seoName' AS "seoName", t->>'name' AS name, t->>'shortName' AS "shortName"
				FROM games, LATERAL (VALUES (data->'home'), (data->'away')) AS s(t)
				WHERE sport = ${sport} AND division = ${division}
					AND game_date BETWEEN ${from} AND ${to}
					AND t->>'seoName' IS NOT NULL AND t->>'seoName' <> ''`;
			return rows;
		} catch (err) {
			recordError(err);
		}
	}
	const seen = new Map<string, StoredTeamIdentity>();
	for (const { game } of memGames.values()) {
		if (game.sport !== sport || game.division !== division) continue;
		if (game.date < from || game.date > to) continue;
		for (const t of [game.home, game.away])
			if (t.seoName && !seen.has(t.seoName))
				seen.set(t.seoName, {
					seoName: t.seoName,
					name: t.name,
					shortName: t.shortName,
				});
	}
	return [...seen.values()];
}

export async function upsertDetail(
	gameId: string,
	kind: DetailKind,
	data: { updatedAt: string },
): Promise<void> {
	await initStore();
	const updatedAt = data.updatedAt;
	storeStats.writes++;
	if (!sql) {
		memDetails.set(`${gameId}:${kind}`, { data, updatedAt });
		return;
	}
	try {
		await sql`
			INSERT INTO game_details (game_id, kind, data, updated_at)
			VALUES (${gameId}, ${kind}, ${JSON.stringify(data)}::text::jsonb, ${updatedAt})
			ON CONFLICT (game_id, kind) DO UPDATE SET
				data = EXCLUDED.data,
				updated_at = EXCLUDED.updated_at`;
	} catch (err) {
		recordError(err);
	}
}

export async function getDetail<T = unknown>(
	gameId: string,
	kind: DetailKind,
): Promise<StoredDetail<T> | null> {
	await initStore();
	if (sql) {
		try {
			const rows = await sql<{ data: T; updated_at: string | Date }[]>`
				SELECT data, updated_at FROM game_details WHERE game_id = ${gameId} AND kind = ${kind}`;
			const row = rows[0];
			if (row) {
				return {
					data: parseJson(row.data),
					updatedAt: new Date(row.updated_at).toISOString(),
				};
			}
		} catch (err) {
			recordError(err);
		}
	}
	return (
		(memDetails.get(`${gameId}:${kind}`) as StoredDetail<T> | undefined) ?? null
	);
}

export async function upsertNewsPosts(posts: StoredNewsPost[]): Promise<void> {
	await initStore();
	storeStats.writes++;
	if (!sql) {
		for (const p of posts) memNews.set(p.id, p);
		return;
	}
	try {
		for (const p of posts) {
			await sql`
				INSERT INTO news_posts (id, published_at, data, updated_at)
				VALUES (${p.id}, ${p.publishedAt}, ${JSON.stringify(p.data)}::text::jsonb, now())
				ON CONFLICT (id) DO UPDATE SET
					published_at = EXCLUDED.published_at,
					data = EXCLUDED.data,
					updated_at = now()`;
		}
	} catch (err) {
		recordError(err);
	}
}

export async function deleteNewsPosts(ids: number[]): Promise<void> {
	await initStore();
	if (ids.length === 0) return;
	if (!sql) {
		for (const id of ids) memNews.delete(id);
		return;
	}
	try {
		await sql`DELETE FROM news_posts WHERE id = ANY(${ids}::int[])`;
	} catch (err) {
		recordError(err);
	}
}

export async function listNewsPosts(limit: number): Promise<StoredNewsPost[]> {
	await initStore();
	if (sql) {
		try {
			const rows = await sql<
				{ id: number; published_at: string | Date; data: unknown }[]
			>`
				SELECT id, published_at, data FROM news_posts
				ORDER BY published_at DESC LIMIT ${limit}`;
			return rows.map((r) => ({
				id: r.id,
				publishedAt: new Date(r.published_at).toISOString(),
				data: parseJson(r.data),
			}));
		} catch (err) {
			recordError(err);
		}
	}
	return [...memNews.values()]
		.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
		.slice(0, limit);
}

export async function pingStore(): Promise<boolean> {
	await initStore();
	if (!sql) return false;
	try {
		await sql`SELECT 1`;
		return true;
	} catch (err) {
		recordError(err);
		return false;
	}
}
