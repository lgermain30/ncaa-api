import type { SchoolEvent } from "./schoolschedule";
import type { Sport } from "./teams";

/*
 * Schedules a school has announced (release graphic, press release) before
 * its Sidearm schedule page lists every game. Games on the school's page win
 * on the same date, so these entries fade out once the site catches up.
 */
const H = "H" as const;
const A = "A" as const;
const N = "N" as const;
const game = (
	date: string,
	opponent: string,
	at: SchoolEvent["at"],
	venue: string | null = null,
): SchoolEvent => ({ date, time: null, tv: null, venue, at, opponent });

const POSTED: Record<string, SchoolEvent[]> = {
	"lacrosse-men:ohio-state:2027": [
		game("2027-02-06", "Bryant", H),
		game("2027-02-10", "Robert Morris", H),
		game("2027-02-13", "Cleveland State", H),
		game("2027-02-20", "Saint Joseph's", H),
		game("2027-02-27", "High Point", H),
		game("2027-03-06", "Georgetown", H),
		game("2027-03-13", "Notre Dame", A),
		game("2027-03-20", "North Carolina", N, "St. Anne's-Belfield"),
		game("2027-03-27", "Rutgers", H),
		game("2027-04-03", "Penn State", A),
		game("2027-04-10", "Maryland", H),
		game("2027-04-17", "Johns Hopkins", A),
		game("2027-04-24", "Michigan", A),
	],
};

export function withPostedSchedule(
	sport: Sport,
	teamId: string,
	season: string,
	events: SchoolEvent[],
): SchoolEvent[] {
	const posted = POSTED[`${sport}:${teamId}:${season}`] ?? [];
	const dates = new Set(events.map((e) => e.date));
	return [...events, ...posted.filter((e) => !dates.has(e.date))];
}
