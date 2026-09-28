import { getBio } from "../store";
import { bioKey, REFRESH_MS, refreshRosterBio } from "./rosterbio";
import { type Division, getTeam, getTeams, type Sport } from "./teams";

/*
 * Low-rate background walk over every team on every board, refreshing bios
 * that are missing or older than REFRESH_MS. One team every PACE_MS so school
 * sites (and lax.com) see a trickle, never a burst; live polling is untouched.
 */

const SPORTS: Sport[] = ["lacrosse-men", "lacrosse-women"];
const DIVISIONS: Division[] = ["d1", "d2", "d3"];
const PACE_MS = 3000;
const START_DELAY_MS = 90 * 1000;
const REPEAT_MS = 24 * 60 * 60 * 1000;

export const rosterBioWalk = {
	running: false,
	teams: 0,
	refreshed: 0,
	lastStartedAt: null as string | null,
	lastFinishedAt: null as string | null,
	lastError: null as string | null,
};

export async function walkRosterBios(): Promise<void> {
	if (rosterBioWalk.running) return;
	rosterBioWalk.running = true;
	rosterBioWalk.teams = 0;
	rosterBioWalk.refreshed = 0;
	rosterBioWalk.lastStartedAt = new Date().toISOString();
	try {
		for (const sport of SPORTS) {
			for (const division of DIVISIONS) {
				const { data: teams } = await getTeams(sport, division);
				for (const t of teams) {
					rosterBioWalk.teams++;
					const stored = await getBio(bioKey(sport, t.id));
					if (
						stored &&
						Date.now() - new Date(stored.updatedAt).getTime() < REFRESH_MS
					)
						continue;
					try {
						const { data: team } = await getTeam(sport, division, t.id);
						if (team) await refreshRosterBio(sport, t.id, team.website);
						rosterBioWalk.refreshed++;
					} catch (err) {
						rosterBioWalk.lastError =
							err instanceof Error ? err.message : String(err);
					}
					await Bun.sleep(PACE_MS);
				}
			}
		}
	} catch (err) {
		rosterBioWalk.lastError = err instanceof Error ? err.message : String(err);
	} finally {
		rosterBioWalk.running = false;
		rosterBioWalk.lastFinishedAt = new Date().toISOString();
	}
}

export function startRosterBioWalk() {
	setTimeout(() => {
		void walkRosterBios();
		setInterval(() => void walkRosterBios(), REPEAT_MS);
	}, START_DELAY_MS);
}
