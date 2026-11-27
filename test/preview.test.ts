import { describe, expect, test } from "bun:test";
import {
	isPreviewId,
	parsePreviewId,
	previewGameFrom,
	previewId,
} from "../src/v1/preview";

describe("preview games", () => {
	const id = previewId("lacrosse-men", "d1", "2027-02-06", "ohio-state", "bryant");

	test("ids round-trip and reject NCAA / malformed ids", () => {
		expect(id).toBe("preview:lacrosse-men:d1:2027-02-06:ohio-state:bryant");
		expect(isPreviewId(id)).toBe(true);
		expect(isPreviewId("6346471")).toBe(false);
		expect(isPreviewId("preview:lacrosse-men:d4:2027-02-06:a:b")).toBe(false);
		expect(parsePreviewId(id)).toEqual({
			sport: "lacrosse-men",
			division: "d1",
			date: "2027-02-06",
			homeId: "ohio-state",
			awayId: "bryant",
		});
	});

	test("builds a pre-game with no scores from team summaries", () => {
		const parsed = parsePreviewId(id)!;
		const g = previewGameFrom(
			id,
			{ id: "ohio-state", name: "Ohio State", seoName: "ohio-st", conference: "Big 10", rank: 17, wins: 10, losses: 4 },
			{ id: "bryant", name: "Bryant", seoName: "bryant", conference: "America East", rank: null, wins: 0, losses: 0 },
			parsed,
		);
		expect(g.status.state).toBe("pre");
		expect(g.home.seoName).toBe("ohio-st");
		expect(g.away.name).toBe("Bryant");
		expect(g.home.score).toBeNull();
		expect(g.home.record).toBeNull();
		expect(g.date).toBe("2027-02-06");
		expect(g.linescore).toEqual([]);
	});
});
