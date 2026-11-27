import { type Division, getTeams, type Sport, type V1TeamSummary } from "./teams";
import type { V1Game, V1Team } from "./types";

/**
 * Preview games: scheduled games from a school's published schedule that NCAA
 * has not created a gamecenter contest for yet (next season). The mobile team
 * schedule opens them so rosters and head-to-head work before the NCAA id exists.
 * Id: preview:<sport>:<division>:<YYYY-MM-DD>:<home team id>:<away team id>
 */
export const PREVIEW_ID_RE =
	/^preview:(lacrosse-men|lacrosse-women):(d[123]):(\d{4}-\d{2}-\d{2}):([a-z0-9-]+):([a-z0-9-]+)$/;

export const isPreviewId = (id: string) => PREVIEW_ID_RE.test(id);

export function parsePreviewId(id: string) {
	const m = PREVIEW_ID_RE.exec(id);
	if (!m) return null;
	return {
		sport: m[1] as Sport,
		division: m[2] as Division,
		date: m[3],
		homeId: m[4],
		awayId: m[5],
	};
}

export function previewId(
	sport: Sport,
	division: Division,
	date: string,
	homeId: string,
	awayId: string,
) {
	return `preview:${sport}:${division}:${date}:${homeId}:${awayId}`;
}

function side(t: V1TeamSummary): V1Team {
	return {
		id: null,
		name: t.name,
		shortName: t.name,
		seoName: t.seoName ?? "",
		char6: "",
		color: null,
		score: null,
		rank: null,
		seed: null,
		record: null,
		conference: t.conference,
		isWinner: false,
	};
}

export function previewGameFrom(
	id: string,
	home: V1TeamSummary,
	away: V1TeamSummary,
	parsed: NonNullable<ReturnType<typeof parsePreviewId>>,
): V1Game {
	return {
		id,
		sport: parsed.sport,
		division: parsed.division,
		date: parsed.date,
		startEpoch: null,
		startTime: "TBA",
		status: {
			state: "pre",
			period: "",
			clock: "",
			display: "TBA",
			finalMessage: "",
		},
		home: side(home),
		away: side(away),
		linescore: [],
		linescoreSource: "ncaa",
		venue: null,
		broadcast: { network: null, liveVideo: false },
		attendance: null,
		bracket: null,
		links: { ncaa: null },
		detailed: false,
		updatedAt: new Date().toISOString(),
	};
}

/** null when the id is not a preview id or either team is unknown. */
export async function getPreviewGame(id: string): Promise<V1Game | null> {
	const parsed = parsePreviewId(id);
	if (!parsed) return null;
	const { data: teams } = await getTeams(parsed.sport, parsed.division);
	const home = teams.find((t) => t.id === parsed.homeId);
	const away = teams.find((t) => t.id === parsed.awayId);
	if (!home || !away) return null;
	return previewGameFrom(id, home, away, parsed);
}
