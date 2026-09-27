import { TieredCache } from "../cache";
import { aggregateTeamTotals, type StoredTeamTotals } from "../store";
import type { Served } from "./service";

/**
 * Season team totals summed from the final box scores we store (shots, saves,
 * caused turnovers, penalties, …) — the stats lax.com's team leaderboards
 * don't publish. `games` is the number of box scores counted, so per-game
 * figures are relative to that, not the schedule length.
 */

export interface V1TeamSeasonStats {
	teamId: string;
	seoName: string;
	name: string;
	shortName: string;
	games: number;
	totals: TeamStatTotals;
	perGame: TeamStatTotals;
}

export type TeamStatTotals = Omit<
	StoredTeamTotals,
	"teamId" | "seoName" | "name" | "shortName" | "games"
>;

const cache = new TieredCache("team-stats", 30 * 60 * 1000);

const round1 = (n: number) => Math.round(n * 10) / 10;

export function toSeasonStats(row: StoredTeamTotals): V1TeamSeasonStats {
	const { teamId, seoName, name, shortName, games, ...totals } = row;
	const perGame = Object.fromEntries(
		Object.entries(totals).map(([k, v]) => [k, games ? round1(v / games) : 0]),
	) as TeamStatTotals;
	return { teamId, seoName, name, shortName, games, totals, perGame };
}

export async function getTeamStats(
	sport: string,
	division: string,
	season: string,
): Promise<Served<V1TeamSeasonStats[]>> {
	const key = `${sport}/${division}/${season}`;
	const fresh = (cache.get(key) ?? (await cache.getShared(key))) as
		| V1TeamSeasonStats[]
		| undefined;
	if (fresh)
		return { data: fresh, updatedAt: new Date().toISOString(), stale: false };
	const rows = await aggregateTeamTotals(sport, division, season);
	const data = rows
		.map(toSeasonStats)
		.sort((a, b) => a.shortName.localeCompare(b.shortName));
	cache.set(key, data);
	return { data, updatedAt: new Date().toISOString(), stale: false };
}
