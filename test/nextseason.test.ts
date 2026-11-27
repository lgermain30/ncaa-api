import { expect, test } from "bun:test";
import { emptyNextSeason, offseasonNextSeason } from "../src/v1/teams";

test("next-season tab appears for every team once the season is over", () => {
	expect(offseasonNextSeason(new Date("2026-11-27T12:00:00Z"))).toBe("2027");
	expect(offseasonNextSeason(new Date("2026-07-01T12:00:00Z"))).toBe("2027");
	expect(offseasonNextSeason(new Date("2026-03-15T12:00:00Z"))).toBeNull();
	expect(offseasonNextSeason(new Date("2026-06-30T12:00:00Z"))).toBeNull();
});

test("emptyNextSeason keeps identity but no results, roster or rank", () => {
	const base = {
		id: "syracuse",
		name: "Syracuse",
		seoName: "syracuse",
		sport: "lacrosse-men",
		division: "d1",
		season: "2026",
		coach: "Gary Gait",
		conference: "Atlantic Coast",
		rank: 7,
		overall: { wins: 13, losses: 6 },
		conferenceRecord: { wins: 3, losses: 4 },
		website: "https://cuse.com",
		seasons: ["2025", "2026"],
		schedule: [{ date: "2026-02-01" }],
		roster: [{ name: "x" }],
		rosterSource: "school",
		rosterSeason: "2026",
		provenance: {
			source: "lax.com",
			verified: true,
			checked: 1,
			disagreed: 0,
			fetchedAt: "",
		},
	} as unknown as Parameters<typeof emptyNextSeason>[0];
	const t = emptyNextSeason(base, "2027");
	expect(t.season).toBe("2027");
	expect(t.name).toBe("Syracuse");
	expect(t.coach).toBe("Gary Gait");
	expect(t.rank).toBeNull();
	expect(t.overall).toEqual({ wins: 0, losses: 0 });
	expect(t.schedule).toEqual([]);
	expect(t.roster).toEqual([]);
	expect(t.rosterSeason).toBeNull();
	expect(t.provenance).toBeNull();
});
