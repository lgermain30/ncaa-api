import { expect, test } from "bun:test";
import { classBucket, rosterSummary } from "../src/v1/matchup";

test("classBucket maps every roster class spelling seen in production", () => {
	const cases: Record<string, string> = {
		Fr: "Fr",
		Fy: "Fr",
		FY: "Fr",
		"R-Fr": "Fr",
		"1st": "Fr",
		"First Year": "Fr",
		Rs: "Fr",
		Rf: "Fr",
		So: "So",
		SO: "So",
		"R-So": "So",
		"2nd": "So",
		"Second Year": "So",
		Jr: "Jr",
		JR: "Jr",
		"R-Jr": "Jr",
		"RS-Jr": "Jr",
		"3rd": "Jr",
		"Third Year": "Jr",
		Sr: "Sr",
		SR: "Sr",
		"R-Sr": "Sr",
		"4th": "Sr",
		"Fourth Year": "Sr",
		Gr: "Gr",
		GR: "Gr",
		"5th": "Gr",
		Fifth: "Gr",
		"Fifth Year": "Gr",
		"Grad Student": "Gr",
	};
	for (const [raw, want] of Object.entries(cases))
		expect([raw, classBucket(raw)]).toEqual([raw, want]);
	expect(classBucket(null)).toBeNull();
});

test("rosterSummary class counts add up to the roster (Yale 'Fy', Syracuse '5th')", () => {
	const years = ["Fy", "So", "Jr", "Sr", "5th", "Gr", "R-Fr"];
	const roster = years.map((year) => ({
		year,
		height: null,
		weight: null,
	})) as never;
	const s = rosterSummary(roster);
	expect(Object.values(s?.classes ?? {}).reduce((a, b) => a + b, 0)).toBe(
		years.length,
	);
});
