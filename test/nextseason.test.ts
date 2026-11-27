import { expect, test } from "bun:test";
import { offseasonNextSeason } from "../src/v1/teams";

test("next-season tab appears for every team once the season is over", () => {
	expect(offseasonNextSeason(new Date("2026-11-27T12:00:00Z"))).toBe("2027");
	expect(offseasonNextSeason(new Date("2026-07-01T12:00:00Z"))).toBe("2027");
	expect(offseasonNextSeason(new Date("2026-03-15T12:00:00Z"))).toBeNull();
	expect(offseasonNextSeason(new Date("2026-06-30T12:00:00Z"))).toBeNull();
});
