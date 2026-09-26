import ExpiryMap from "expiry-map";
import { upstreamFetch } from "./upstream";

/**
 * GetGamecenterGameById_web: clock, period, linescores, venue and network for
 * one contest. Shared by the /game/:id route and the scoreboard enrichment so
 * the scoreboard never has to call this service's own public URL.
 */

const GAMECENTER_HASH =
	"93a02c7193c89d85bcdda8c1784925d9b64657f73ef584382e2297af555acd4b";

export interface GamecenterLinescore {
	period?: string | number;
	home?: string | number;
	visit?: string | number;
}

export interface GamecenterContest {
	id?: string | number;
	gameState?: string;
	clock?: string;
	currentPeriod?: string;
	network?: string;
	attendance?: string | number | null;
	linescores?: GamecenterLinescore[];
	location?: {
		venue?: string;
		city?: string;
		stateUsps?: string;
	} | null;
}

export interface GamecenterData {
	contests?: GamecenterContest[];
}

const cache = new ExpiryMap<string, GamecenterData>(45 * 1000);
const inflight = new Map<string, Promise<GamecenterData | null>>();

export function gamecenterUrl(id: string) {
	const extensions = JSON.stringify({
		persistedQuery: { version: 1, sha256Hash: GAMECENTER_HASH },
	});
	const variables = JSON.stringify({ id, week: null, staticTestEnv: null });
	return `https://sdataprod.ncaa.com/?meta=GetGamecenterGameById_web&extensions=${encodeURIComponent(
		extensions,
	)}&variables=${encodeURIComponent(variables)}`;
}

/** Returns the `data` object of the gamecenter response, or null on any failure. */
export async function fetchGamecenter(
	id: string,
): Promise<GamecenterData | null> {
	if (!id) return null;
	const cached = cache.get(id);
	if (cached) return cached;

	const pending = inflight.get(id);
	if (pending) return pending;

	const p = (async () => {
		try {
			const res = await upstreamFetch(gamecenterUrl(id));
			if (!res.ok) return null;
			const json = (await res.json()) as { data?: GamecenterData };
			const data = json?.data;
			if (!data || !Array.isArray(data.contests)) return null;
			cache.set(id, data);
			return data;
		} catch {
			return null;
		} finally {
			inflight.delete(id);
		}
	})();
	inflight.set(id, p);
	return p;
}

export interface GameDetails {
	linescores: { period: string; home: string; visit: string }[];
	venue: string;
	city: string;
	state: string;
	attendance: string;
	network: string;
}

const EMPTY_DETAILS: GameDetails = {
	linescores: [],
	venue: "",
	city: "",
	state: "",
	attendance: "",
	network: "",
};

/** Flattened per-game details used to enrich scoreboard entries. */
export async function fetchGameDetails(id: string): Promise<GameDetails> {
	const data = await fetchGamecenter(id);
	const game = data?.contests?.[0];
	if (!game) return EMPTY_DETAILS;

	const linescores = Array.isArray(game.linescores)
		? game.linescores.map((ls) => ({
				period: ls.period?.toString() ?? "",
				home: ls.home?.toString() ?? "",
				visit: ls.visit?.toString() ?? "",
			}))
		: [];

	return {
		linescores,
		venue: game.location?.venue ?? "",
		city: game.location?.city ?? "",
		state: game.location?.stateUsps ?? "",
		attendance: game.attendance?.toString() ?? "",
		network: game.network ?? "",
	};
}
