import { describe, expect, test } from "bun:test";
import { dedupeTeams } from "../src/v1/teams";

describe("dedupeTeams", () => {
	test("keeps one row per id, preferring a conference and more games", () => {
		const row = (
			id: string,
			conference: string | null,
			wins: number,
			losses: number,
		) => ({ id, conference, wins, losses });
		const out = dedupeTeams([
			row("trinity-dc-w", null, 0, 0),
			row("lewis-clark-w", "DIII Independent", 5, 4),
			row("trinity-dc-w", "DIII Independent", 0, 0),
			row("trinity-dc-w", "DIII Independent", 0, 3),
			row("trinity-dc-w", "DIII Independent", 0, 0),
		]);
		expect(out).toEqual([
			row("lewis-clark-w", "DIII Independent", 5, 4),
			row("trinity-dc-w", "DIII Independent", 0, 3),
		]);
	});
});
