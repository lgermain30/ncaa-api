import { SQL } from "bun";
import type { V1Game, V1TeamLine } from "./v1/types";

/**
 * Durable game state. Postgres when DATABASE_URL is set (Railway), otherwise
 * an in-process Map so dev/test and a fresh deploy work with no database.
 *
 *   games         one row per contest: normalized V1Game + sport/division/date
 *   game_details  (game_id, kind) -> jsonb   kind = boxscore | plays
 *   news_posts    CLN WordPress posts pushed by the cln-teams plugin
 *   roster_bios   key -> jsonb  player height/weight/HS scraped from school sites
 *   lax_seasons   key -> jsonb  past-season team pages (lax.com) kept as our own
 *                 copy once their results agree with the NCAA games we store
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
	/** Queries answered with another board's rows (retried). */
	mismatchedResults: 0,
};

const memGames = new Map<string, { game: V1Game; updatedAt: string }>();
const memDetails = new Map<string, StoredDetail>();
const memNews = new Map<number, StoredNewsPost>();
const memBios = new Map<string, StoredDetail>();
const memLax = new Map<string, StoredDetail>();

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
	`CREATE TABLE IF NOT EXISTS roster_bios (
		key text PRIMARY KEY,
		data jsonb NOT NULL,
		updated_at timestamptz NOT NULL DEFAULT now()
	)`,
	`CREATE TABLE IF NOT EXISTS lax_seasons (
		key text PRIMARY KEY,
		data jsonb NOT NULL,
		updated_at timestamptz NOT NULL DEFAULT now()
	)`,
];

/** Connects and applies the schema once; safe to call repeatedly. */
/**
 * Early rows were saved as a JSON string inside jsonb, which every
 * `data->'field'` query silently skips (team logos, records). Unwrap them once.
 */
async function unwrapStringJson(client: SQL) {
	for (const table of ["games", "game_details"]) {
		try {
			await client.unsafe(
				`UPDATE ${table} SET data = (data #>> '{}')::jsonb WHERE jsonb_typeof(data) = 'string'`,
			);
		} catch (err) {
			recordError(err);
		}
	}
}

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
			await unwrapStringJson(client);
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
	memBios.clear();
	memLax.clear();
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
			// Rows echo sport/division: under load prod has handed this query
			// another board's rows (men's D1 got D2's teams), wiping logos.
			for (let attempt = 0; attempt < 3; attempt++) {
				const rows = await sql<
					(StoredTeamIdentity & { sport: string; division: string })[]
				>`
					SELECT DISTINCT ON (t->>'seoName')
						t->>'seoName' AS "seoName", t->>'name' AS name, t->>'shortName' AS "shortName",
						sport, division
					FROM games, LATERAL (VALUES (data->'home'), (data->'away')) AS s(t)
					WHERE sport = ${sport} AND division = ${division}
						AND game_date BETWEEN ${from} AND ${to}
						AND t->>'seoName' IS NOT NULL AND t->>'seoName' <> ''`;
				if (rows.every((r) => r.sport === sport && r.division === division))
					return rows.map(({ seoName, name, shortName }) => ({
						seoName,
						name,
						shortName,
					}));
				storeStats.mismatchedResults++;
			}
			throw new Error(`listBoardTeams ${sport}/${division}: mismatched rows`);
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

export interface StoredTeamTotals {
	teamId: string;
	seoName: string;
	name: string;
	shortName: string;
	games: number;
	shots: number;
	shotsOnGoal: number;
	groundBalls: number;
	turnovers: number;
	causedTurnovers: number;
	saves: number;
	penalties: number;
	penaltyMinutes: number;
	faceoffsWon: number;
	faceoffsLost: number;
	clears: number;
	clearAttempts: number;
	extraManGoals: number;
	extraManOpportunities: number;
}

/**
 * Season totals per team summed from stored final box scores
 * (game_details.kind = 'boxscore' → teamStats[]). Only games whose box score
 * we hold count toward `games`.
 */
export async function aggregateTeamTotals(
	sport: string,
	division: string,
	season: string,
): Promise<StoredTeamTotals[]> {
	await initStore();
	const from = `${season}-01-01`;
	const to = `${season}-12-31`;
	if (sql) {
		try {
			const rows = await sql<StoredTeamTotals[]>`
				WITH lines AS (
					SELECT g.data AS game, ts
					FROM games g
					JOIN game_details d ON d.game_id = g.id AND d.kind = 'boxscore'
					CROSS JOIN LATERAL jsonb_array_elements(d.data->'teamStats') AS ts
					WHERE g.sport = ${sport} AND g.division = ${division}
						AND g.game_date BETWEEN ${from} AND ${to}
						AND g.state = 'final'
				),
				named AS (
					SELECT ts,
						ts->>'teamId' AS team_id,
						CASE WHEN game->'home'->>'id' = ts->>'teamId' THEN game->'home' ELSE game->'away' END AS team
					FROM lines
				)
				SELECT team_id AS "teamId",
					max(team->>'seoName') AS "seoName",
					max(team->>'name') AS name,
					max(team->>'shortName') AS "shortName",
					count(*)::int AS games,
					coalesce(round(sum((ts->>'shots')::numeric)), 0)::int AS shots,
					coalesce(round(sum((ts->>'shotsOnGoal')::numeric)), 0)::int AS "shotsOnGoal",
					coalesce(round(sum((ts->>'groundBalls')::numeric)), 0)::int AS "groundBalls",
					coalesce(round(sum((ts->>'turnovers')::numeric)), 0)::int AS turnovers,
					coalesce(round(sum((ts->>'causedTurnovers')::numeric)), 0)::int AS "causedTurnovers",
					coalesce(round(sum((ts->>'saves')::numeric)), 0)::int AS saves,
					coalesce(round(sum((ts->'penalties'->>'count')::numeric)), 0)::int AS penalties,
					coalesce(round(sum((ts->'penalties'->>'minutes')::numeric)), 0)::int AS "penaltyMinutes",
					coalesce(round(sum((ts->>'faceoffsWon')::numeric)), 0)::int AS "faceoffsWon",
					coalesce(round(sum((ts->>'faceoffsLost')::numeric)), 0)::int AS "faceoffsLost",
					coalesce(round(sum((ts->>'clears')::numeric)), 0)::int AS clears,
					coalesce(round(sum((ts->>'clearAttempts')::numeric)), 0)::int AS "clearAttempts",
					coalesce(round(sum((ts->'extraMan'->>'goals')::numeric)), 0)::int AS "extraManGoals",
					coalesce(round(sum((ts->'extraMan'->>'opportunities')::numeric)), 0)::int AS "extraManOpportunities"
				FROM named
				WHERE team->>'id' = team_id
				GROUP BY team_id`;
			return rows;
		} catch (err) {
			recordError(err);
		}
	}
	const acc = new Map<string, StoredTeamTotals>();
	for (const { game } of memGames.values()) {
		if (game.sport !== sport || game.division !== division) continue;
		if (game.date < from || game.date > to) continue;
		if (game.status.state !== "final") continue;
		const box = memDetails.get(`${game.id}:boxscore`)?.data as
			| { teamStats?: TeamLineLike[] }
			| undefined;
		for (const ts of box?.teamStats ?? []) {
			const team = [game.home, game.away].find((t) => t.id === ts.teamId);
			if (!team) continue;
			const cur = acc.get(ts.teamId) ?? {
				teamId: ts.teamId,
				seoName: team.seoName,
				name: team.name,
				shortName: team.shortName,
				games: 0,
				shots: 0,
				shotsOnGoal: 0,
				groundBalls: 0,
				turnovers: 0,
				causedTurnovers: 0,
				saves: 0,
				penalties: 0,
				penaltyMinutes: 0,
				faceoffsWon: 0,
				faceoffsLost: 0,
				clears: 0,
				clearAttempts: 0,
				extraManGoals: 0,
				extraManOpportunities: 0,
			};
			cur.games++;
			cur.shots += ts.shots ?? 0;
			cur.shotsOnGoal += ts.shotsOnGoal ?? 0;
			cur.groundBalls += ts.groundBalls ?? 0;
			cur.turnovers += ts.turnovers ?? 0;
			cur.causedTurnovers += ts.causedTurnovers ?? 0;
			cur.saves += ts.saves ?? 0;
			cur.penalties += ts.penalties?.count ?? 0;
			cur.penaltyMinutes += ts.penalties?.minutes ?? 0;
			cur.faceoffsWon += ts.faceoffsWon ?? 0;
			cur.faceoffsLost += ts.faceoffsLost ?? 0;
			cur.clears += ts.clears ?? 0;
			cur.clearAttempts += ts.clearAttempts ?? 0;
			cur.extraManGoals += ts.extraMan?.goals ?? 0;
			cur.extraManOpportunities += ts.extraMan?.opportunities ?? 0;
			acc.set(ts.teamId, cur);
		}
	}
	return [...acc.values()];
}

export interface StoredTeamFinal {
	game: V1Game;
	/** box score team lines; null when we hold no box score */
	teamStats: V1TeamLine[] | null;
}

/** A team's finals (by NCAA seoName, any division) between two dates, oldest first. */
export async function listTeamFinals(
	sport: string,
	seoName: string,
	from: string,
	to: string,
): Promise<StoredTeamFinal[]> {
	await initStore();
	if (sql) {
		try {
			const rows = await sql<{ data: V1Game | string; team_stats: unknown }[]>`
				SELECT g.data, d.data->'teamStats' AS team_stats
				FROM games g
				LEFT JOIN game_details d ON d.game_id = g.id AND d.kind = 'boxscore'
				WHERE g.sport = ${sport} AND g.state = 'final'
					AND g.game_date BETWEEN ${from} AND ${to}
					AND (g.data->'home'->>'seoName' = ${seoName}
						OR g.data->'away'->>'seoName' = ${seoName})
				ORDER BY g.game_date, g.id`;
			return rows.map((r) => ({
				game: parseJson(r.data),
				teamStats:
					r.team_stats == null
						? null
						: parseJson(r.team_stats as V1TeamLine[] | string),
			}));
		} catch (err) {
			recordError(err);
		}
	}
	return [...memGames.values()]
		.filter(
			({ game }) =>
				game.sport === sport &&
				game.status.state === "final" &&
				game.date >= from &&
				game.date <= to &&
				(game.home.seoName === seoName || game.away.seoName === seoName),
		)
		.sort((a, b) => a.game.date.localeCompare(b.game.date))
		.map(({ game }) => ({
			game,
			teamStats:
				(
					memDetails.get(`${game.id}:boxscore`)?.data as
						| { teamStats?: V1TeamLine[] }
						| undefined
				)?.teamStats ?? null,
		}));
}

export interface StoredPlayerGameLine {
	gameId: string;
	name: string;
	firstName: string | null;
	lastName: string | null;
	number: number | null;
	played: boolean;
	starter: boolean;
}

/**
 * One row per player per stored final box score for a team (by NCAA seoName)
 * in a season, plus how many box scores there were — the basis for games
 * played / started, which lax.com doesn't publish.
 */
export async function listPlayerGameLines(
	sport: string,
	division: string,
	season: string,
	seoName: string,
): Promise<{ games: number; lines: StoredPlayerGameLine[] }> {
	await initStore();
	const from = `${season}-01-01`;
	const to = `${season}-12-31`;
	if (sql) {
		try {
			const rows = await sql<
				{ id: string; team_id: string | null; players: unknown }[]
			>`
				SELECT g.id,
					CASE WHEN g.data->'home'->>'seoName' = ${seoName}
						THEN g.data->'home'->>'id' ELSE g.data->'away'->>'id' END AS team_id,
					d.data->'players' AS players
				FROM games g
				JOIN game_details d ON d.game_id = g.id AND d.kind = 'boxscore'
				WHERE g.sport = ${sport} AND g.division = ${division}
					AND g.game_date BETWEEN ${from} AND ${to}
					AND g.state = 'final'
					AND (g.data->'home'->>'seoName' = ${seoName}
						OR g.data->'away'->>'seoName' = ${seoName})`;
			return playerGameLines(
				rows.map((r) => ({
					gameId: r.id,
					teamId: r.team_id,
					players: parseJson(r.players) as PlayerLineLike[] | null,
				})),
			);
		} catch (err) {
			recordError(err);
		}
	}
	const boxes: {
		gameId: string;
		teamId: string | null;
		players: PlayerLineLike[] | null;
	}[] = [];
	for (const { game } of memGames.values()) {
		if (game.sport !== sport || game.division !== division) continue;
		if (game.date < from || game.date > to) continue;
		if (game.status.state !== "final") continue;
		const team = [game.home, game.away].find((t) => t.seoName === seoName);
		if (!team) continue;
		const box = memDetails.get(`${game.id}:boxscore`)?.data as
			| { players?: PlayerLineLike[] }
			| undefined;
		if (!box) continue;
		boxes.push({
			gameId: game.id,
			teamId: team.id,
			players: box.players ?? null,
		});
	}
	return playerGameLines(boxes);
}

interface PlayerLineLike {
	teamId: string;
	name: string;
	firstName?: string | null;
	lastName?: string | null;
	number?: number | null;
	played?: boolean | null;
	starter?: boolean | null;
}

function playerGameLines(
	boxes: {
		gameId: string;
		teamId: string | null;
		players: PlayerLineLike[] | null;
	}[],
): { games: number; lines: StoredPlayerGameLine[] } {
	const lines: StoredPlayerGameLine[] = [];
	for (const b of boxes)
		for (const p of b.players ?? [])
			if (p.teamId === b.teamId)
				lines.push({
					gameId: b.gameId,
					name: p.name,
					firstName: p.firstName || null,
					lastName: p.lastName || null,
					number: p.number ?? null,
					// some stored boxes flag a starter as not participating
					played: p.played !== false || p.starter === true,
					starter: p.starter === true,
				});
	return { games: boxes.length, lines };
}

interface TeamLineLike {
	teamId: string;
	shots?: number | null;
	shotsOnGoal?: number | null;
	groundBalls?: number | null;
	turnovers?: number | null;
	causedTurnovers?: number | null;
	saves?: number | null;
	penalties?: { count: number; minutes: number } | null;
	faceoffsWon?: number | null;
	faceoffsLost?: number | null;
	clears?: number | null;
	clearAttempts?: number | null;
	extraMan?: { goals: number; opportunities: number } | null;
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

type KvTable = "roster_bios" | "lax_seasons";
const memKv: Record<KvTable, Map<string, StoredDetail>> = {
	roster_bios: memBios,
	lax_seasons: memLax,
};

async function upsertKv(
	table: KvTable,
	key: string,
	data: unknown,
): Promise<void> {
	await initStore();
	const updatedAt = new Date().toISOString();
	storeStats.writes++;
	if (!sql) {
		memKv[table].set(key, { data, updatedAt });
		return;
	}
	const json = JSON.stringify(data);
	try {
		if (table === "roster_bios")
			await sql`
				INSERT INTO roster_bios (key, data, updated_at)
				VALUES (${key}, ${json}::text::jsonb, ${updatedAt})
				ON CONFLICT (key) DO UPDATE SET
					data = EXCLUDED.data,
					updated_at = EXCLUDED.updated_at`;
		else
			await sql`
				INSERT INTO lax_seasons (key, data, updated_at)
				VALUES (${key}, ${json}::text::jsonb, ${updatedAt})
				ON CONFLICT (key) DO UPDATE SET
					data = EXCLUDED.data,
					updated_at = EXCLUDED.updated_at`;
	} catch (err) {
		recordError(err);
	}
}

async function getKv<T>(
	table: KvTable,
	key: string,
): Promise<StoredDetail<T> | null> {
	await initStore();
	if (sql) {
		try {
			type Row = { data: T; updated_at: string | Date };
			const rows =
				table === "roster_bios"
					? await sql<Row[]>`
						SELECT data, updated_at FROM roster_bios WHERE key = ${key}`
					: await sql<Row[]>`
						SELECT data, updated_at FROM lax_seasons WHERE key = ${key}`;
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
		return null;
	}
	return (memKv[table].get(key) as StoredDetail<T> | undefined) ?? null;
}

export const upsertBio = (key: string, data: unknown) =>
	upsertKv("roster_bios", key, data);
export const getBio = <T = unknown>(key: string) =>
	getKv<T>("roster_bios", key);
export const upsertLaxSeason = (key: string, data: unknown) =>
	upsertKv("lax_seasons", key, data);
export const getLaxSeason = <T = unknown>(key: string) =>
	getKv<T>("lax_seasons", key);

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
