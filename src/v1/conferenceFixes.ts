/**
 * Corrections for lax.com conference data, which lags realignment: it omits
 * the Big 12 and WIAC women's leagues, files New Haven under the DII NE10 in
 * the women's DI standings, and keeps Hamline/Saint Benedict in the MWLC.
 * Sources: big12sports.com, northeastconference.org, wiacsports.com standings.
 */

type Fix = { conference: string; from: number };

/** lax.com team id -> conference it plays in from the given season on. */
export const TEAM_CONFERENCE_FIXES: Record<string, Fix> = {
	"azstate-w": { conference: "Big 12", from: 2026 },
	"cincinnati-w": { conference: "Big 12", from: 2026 },
	"colorado-w": { conference: "Big 12", from: 2026 },
	"florida-w": { conference: "Big 12", from: 2026 },
	"sdstate-w": { conference: "Big 12", from: 2026 },
	"ucdavis-w": { conference: "Big 12", from: 2026 },
	"new-haven-w": { conference: "Northeast Conference", from: 2026 },
	"colorado-college-w": { conference: "WIAC", from: 2026 },
	"uwriver-falls-w": { conference: "WIAC", from: 2026 },
	"uwlacrosse-w": { conference: "WIAC", from: 2026 },
	"wisconsin-eau-claire-w": { conference: "WIAC", from: 2026 },
	"saint-benedict-w": { conference: "WIAC", from: 2026 },
	"hamline-w": { conference: "WIAC", from: 2026 },
	"uwstevenspoint-w": { conference: "WIAC", from: 2026 },
	"uw-stout-w": { conference: "WIAC", from: 2026 },
	"augsburg-w": { conference: "WIAC", from: 2026 },
};

export function conferenceFix(id: string, season?: number): string | null {
	const fix = TEAM_CONFERENCE_FIXES[id];
	return fix && (season == null || season >= fix.from) ? fix.conference : null;
}

export type LaxStandingRow = {
	id?: string;
	name: string;
	url: string;
	logo_url?: string;
	record?: string;
	wins: string;
	losses: string;
	goals_for?: string;
	goals_against?: string;
	rank?: string;
	conf_wins: number;
	conf_losses: number;
};
export type LaxStandingBlock = {
	conference: { name: string; id?: string };
	conf_leaderboard: LaxStandingRow[];
};

/** Conference blocks lax.com lists under the wrong division (every season). */
const WRONG_DIVISION_BLOCKS: Record<string, string[]> = {
	"lacrosse-women|d1": ["NE10"],
};

const row = (
	url: string,
	name: string,
	confW: number,
	confL: number,
	w: number,
	l: number,
): LaxStandingRow => ({
	name,
	url,
	logo_url: `//www.laxshop.com/team_logos/${url}.jpg`,
	record: `${w} - ${l}`,
	wins: String(w),
	losses: String(l),
	rank: "0",
	conf_wins: confW,
	conf_losses: confL,
});

/** Official final standings for teams lax.com misses, by sport|division|season. */
const SEASON_ROWS: Record<
	string,
	{ drop?: string[]; rows: Record<string, LaxStandingRow[]> }
> = {
	"lacrosse-women|d1|2026": {
		// Saint Francis (PA) did not play an NEC schedule in 2026.
		drop: ["saintfrancis-w"],
		rows: {
			"Big 12": [
				row("florida-w", "Florida", 5, 0, 15, 4),
				row("colorado-w", "Colorado", 4, 1, 16, 4),
				row("azstate-w", "Arizona State", 3, 2, 8, 10),
				row("ucdavis-w", "UC Davis", 2, 3, 7, 8),
				row("cincinnati-w", "Cincinnati", 1, 4, 9, 8),
				row("sdstate-w", "San Diego State", 0, 5, 3, 13),
			],
			"Northeast Conference": [row("new-haven-w", "New Haven", 4, 5, 5, 9)],
		},
	},
	"lacrosse-women|d3|2026": {
		rows: {
			WIAC: [
				row("colorado-college-w", "Colorado College", 8, 0, 16, 4),
				row("uwriver-falls-w", "UW-River Falls", 7, 1, 15, 4),
				row("uwlacrosse-w", "UW-La Crosse", 6, 2, 13, 5),
				row("wisconsin-eau-claire-w", "UW-Eau Claire", 5, 3, 8, 6),
				row("saint-benedict-w", "Saint Benedict", 4, 4, 6, 7),
				row("hamline-w", "Hamline", 3, 5, 10, 6),
				row("uwstevenspoint-w", "UW-Stevens Point", 2, 6, 8, 8),
				row("uw-stout-w", "UW-Stout", 1, 7, 6, 9),
				row("augsburg-w", "Augsburg", 0, 8, 0, 12),
			],
		},
	},
};

const same = (a: string, b: string) =>
	a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Conference record for a team whose conference was corrected, from the
 * official rows when we have them; null otherwise (lax.com's is the old league's).
 */
export function fixedConferenceRecord(
	sport: string,
	division: string,
	season: number,
	id: string,
): { wins: number; losses: number } | null {
	const rows = SEASON_ROWS[`${sport}|${division}|${season}`]?.rows ?? {};
	for (const list of Object.values(rows)) {
		const r = list.find((x) => x.url === id);
		if (r) return { wins: r.conf_wins, losses: r.conf_losses };
	}
	return null;
}

export function applyStandingsFixes(
	sport: string,
	division: string,
	season: number,
	blocks: LaxStandingBlock[],
): LaxStandingBlock[] {
	const wrong = WRONG_DIVISION_BLOCKS[`${sport}|${division}`] ?? [];
	// A misfiled block keeps only teams with a known conference; they are moved below.
	const out = blocks.map((b) => ({
		...b,
		conf_leaderboard: (b.conf_leaderboard ?? []).filter(
			(r) =>
				!wrong.some((n) => same(n, b.conference?.name ?? "")) ||
				conferenceFix(r.url, season) !== null,
		),
	}));
	const blockFor = (name: string) => {
		let b = out.find((x) => same(x.conference.name, name));
		if (!b) {
			b = { conference: { name }, conf_leaderboard: [] };
			out.push(b);
		}
		return b;
	};
	const remove = (url: string) => {
		let found: LaxStandingRow | undefined;
		for (const b of out) {
			const i = b.conf_leaderboard.findIndex((r) => r.url === url);
			if (i >= 0) found ??= b.conf_leaderboard.splice(i, 1)[0];
		}
		return found;
	};

	const fixed = SEASON_ROWS[`${sport}|${division}|${season}`];
	for (const url of fixed?.drop ?? []) remove(url);
	for (const [name, rows] of Object.entries(fixed?.rows ?? {})) {
		const b = blockFor(name);
		for (const r of rows) {
			const old = remove(r.url);
			b.conf_leaderboard.push(
				old
					? {
							...old,
							...r,
							id: old.id,
							logo_url: old.logo_url,
							goals_for: old.goals_for,
							goals_against: old.goals_against,
						}
					: r,
			);
		}
		b.conf_leaderboard.sort(
			(a, z) =>
				z.conf_wins - a.conf_wins ||
				a.conf_losses - z.conf_losses ||
				Number(z.wins) - Number(a.wins),
		);
	}

	// Later seasons: keep each team's lax.com record but file it under its real conference.
	for (const b of [...out]) {
		for (const r of [...b.conf_leaderboard]) {
			const conf = conferenceFix(r.url, season);
			if (conf && !same(conf, b.conference.name)) {
				const moved = remove(r.url);
				if (moved) blockFor(conf).conf_leaderboard.push(moved);
			}
		}
	}
	return out.filter((b) => b.conf_leaderboard.length > 0);
}
