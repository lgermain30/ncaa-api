import {
	boxscoreHashes,
	getDivisionCode,
	getSeasonYear,
	newCodesBySport,
	playByPlayHashes,
	teamStatsHashes,
} from "../codes";
import { fetchGamecenter, type GamecenterContest } from "../gamecenter";
import { fetchGqlScoreboard } from "../scoreboard/scoreboard";
import type { Contest as ScoreboardContest } from "../scoreboard/types";
import { UpstreamError, upstreamFetch } from "../upstream";
import type { RawBoxscore, RawPlayByPlay } from "./normalize";

/*
 * Thin in-process fetchers for the NCAA persisted queries the /v1 layer and
 * the poller need. All go through upstreamFetch (timeout/retry/breaker).
 */

function persistedUrl(hash: string, contestId: string) {
	return `https://sdataprod.ncaa.com/?extensions={"persistedQuery":{"version":1,"sha256Hash":"${hash}"}}&variables={"contestId":"${contestId}","staticTestEnv":null}`;
}

async function persisted<T>(
	hash: string,
	contestId: string,
	pluck: (json: unknown) => T | undefined,
): Promise<T | null> {
	const url = persistedUrl(hash, contestId);
	const res = await upstreamFetch(url);
	if (res.status === 404) return null;
	if (!res.ok) {
		throw new UpstreamError(
			`NCAA persisted query HTTP ${res.status}`,
			url,
			res.status,
		);
	}
	const json = await res.json();
	return pluck(json) ?? null;
}

interface BoxscoreEnvelope {
	data?: { boxscore?: RawBoxscore };
}
interface PbpEnvelope {
	data?: { playbyplay?: RawPlayByPlay };
}

/** Player lines + team totals (GetGamecenterBoxscoreLacrosseById_web). */
export function fetchLacrosseBoxscore(contestId: string) {
	return persisted<RawBoxscore>(
		boxscoreHashes.TeamStatsLacrosse,
		contestId,
		(j) => (j as BoxscoreEnvelope).data?.boxscore,
	);
}

/** Team stats incl. faceoffs/clears (lacrosse team-stats query). */
export function fetchLacrosseTeamStats(contestId: string) {
	return persisted<RawBoxscore>(
		teamStatsHashes.TeamStatsLacrosse,
		contestId,
		(j) => (j as BoxscoreEnvelope).data?.boxscore,
	);
}

export function fetchPlayByPlay(contestId: string) {
	return persisted<RawPlayByPlay>(
		playByPlayHashes.PlayByPlayGenericSport,
		contestId,
		(j) => (j as PbpEnvelope).data?.playbyplay,
	);
}

export async function fetchGamecenterContest(
	contestId: string,
): Promise<GamecenterContest | null> {
	const data = await fetchGamecenter(contestId);
	return data?.contests?.[0] ?? null;
}

/** Raw GetContests rows for one sport/division/date (YYYY-MM-DD). */
export async function fetchScoreboardContests(
	sport: string,
	division: string,
	date: string,
): Promise<ScoreboardContest[]> {
	const sportCodes = newCodesBySport[sport];
	if (!sportCodes?.code || sportCodes.divisions?.[division] === undefined) {
		throw new Error(`Unsupported sport/division ${sport}/${division}`);
	}
	const [y, m, d] = date.split("-");
	const contestDate = `${y}/${m}/${d}`;
	const json = await fetchGqlScoreboard({
		sportCode: sportCodes.code,
		division: getDivisionCode(sport, division),
		seasonYear: getSeasonYear(new Date(`${y}-${m}-${d}T12:00:00Z`)),
		contestDate,
	});
	return (json?.data?.contests ?? []) as ScoreboardContest[];
}
