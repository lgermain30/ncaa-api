import { describe, expect, test } from "bun:test";
import {
	applyStandingsFixes,
	conferenceFix,
	fixedConferenceRecord,
	type LaxStandingBlock,
} from "../src/v1/conferenceFixes";

const r = (url: string, cw = 0, cl = 0) => ({
	name: url,
	url,
	wins: "1",
	losses: "1",
	goals_for: "10",
	goals_against: "9",
	conf_wins: cw,
	conf_losses: cl,
});

describe("conference fixes", () => {
	test("team conference applies from its season on", () => {
		expect(conferenceFix("florida-w")).toBe("Big 12");
		expect(conferenceFix("hamline-w", 2026)).toBe("WIAC");
		expect(conferenceFix("hamline-w", 2025)).toBeNull();
		expect(conferenceFix("bucknell")).toBeNull();
	});

	test("women DI 2026: drops NE10, adds Big 12, moves New Haven to NEC", () => {
		const blocks: LaxStandingBlock[] = [
			{
				conference: { name: "NE10" },
				conf_leaderboard: [r("pace-w"), r("new-haven-w")],
			},
			{
				conference: { name: "Northeast Conference" },
				conf_leaderboard: [r("stonehill-w", 9, 1), r("saintfrancis-w")],
			},
		];
		const out = applyStandingsFixes("lacrosse-women", "d1", 2026, blocks);
		const names = out.map((b) => b.conference.name);
		expect(names).not.toContain("NE10");
		const big12 = out.find((b) => b.conference.name === "Big 12");
		expect(big12?.conf_leaderboard.map((x) => x.url)).toEqual([
			"florida-w",
			"colorado-w",
			"azstate-w",
			"ucdavis-w",
			"cincinnati-w",
			"sdstate-w",
		]);
		const nec = out.find((b) => b.conference.name === "Northeast Conference");
		expect(nec?.conf_leaderboard.map((x) => x.url)).toEqual([
			"stonehill-w",
			"new-haven-w",
		]);
		expect(nec?.conf_leaderboard[1]).toMatchObject({
			conf_wins: 4,
			conf_losses: 5,
		});
	});

	test("women DIII 2026: Hamline leaves the MWLC for the WIAC", () => {
		const out = applyStandingsFixes("lacrosse-women", "d3", 2026, [
			{
				conference: { name: "MIDWEST WOMEN'S LACROSSE CONFERENCE" },
				conf_leaderboard: [r("hamline-w"), r("wartburg-w")],
			},
		]);
		const mwlc = out.find((b) => b.conference.name.startsWith("MIDWEST"));
		expect(mwlc?.conf_leaderboard.map((x) => x.url)).toEqual(["wartburg-w"]);
		const wiac = out.find((b) => b.conference.name === "WIAC");
		expect(wiac?.conf_leaderboard).toHaveLength(9);
		expect(
			wiac?.conf_leaderboard.find((x) => x.url === "hamline-w")?.goals_for,
		).toBe("10");
	});

	test("later seasons move a mislabeled team, keeping its record", () => {
		const out = applyStandingsFixes("lacrosse-women", "d3", 2027, [
			{
				conference: { name: "MIDWEST WOMEN'S LACROSSE CONFERENCE" },
				conf_leaderboard: [r("hamline-w", 2, 1)],
			},
		]);
		expect(out).toHaveLength(1);
		expect(out[0].conference.name).toBe("WIAC");
		expect(out[0].conf_leaderboard[0]).toMatchObject({
			url: "hamline-w",
			conf_wins: 2,
		});
	});

	test("New Haven keeps its lax.com row when the NE10 block is dropped", () => {
		const out = applyStandingsFixes("lacrosse-women", "d1", 2027, [
			{
				conference: { name: "NE10" },
				conf_leaderboard: [r("pace-w"), r("new-haven-w", 1, 0)],
			},
		]);
		expect(out.map((b) => b.conference.name)).toEqual(["Northeast Conference"]);
		expect(out[0].conf_leaderboard[0]).toMatchObject({
			url: "new-haven-w",
			conf_wins: 1,
		});
		const y26 = applyStandingsFixes("lacrosse-women", "d1", 2026, [
			{ conference: { name: "NE10" }, conf_leaderboard: [r("new-haven-w")] },
		]);
		const nh = y26.find((b) => b.conference.name === "Northeast Conference")
			?.conf_leaderboard[0];
		expect(nh).toMatchObject({
			url: "new-haven-w",
			conf_wins: 4,
			goals_for: "10",
		});
	});

	test("fixed conference record comes from official rows", () => {
		expect(
			fixedConferenceRecord("lacrosse-women", "d3", 2026, "hamline-w"),
		).toEqual({ wins: 3, losses: 5 });
		expect(
			fixedConferenceRecord("lacrosse-women", "d3", 2027, "hamline-w"),
		).toBeNull();
	});

	test("New Haven is dropped from the women's DII standings", () => {
		const out = applyStandingsFixes("lacrosse-women", "d2", 2026, [
			{
				conference: { name: "NE10" },
				conf_leaderboard: [r("pace-w"), r("new-haven-w")],
			},
		]);
		expect(out.map((b) => b.conference.name)).toEqual(["NE10"]);
		expect(out[0].conf_leaderboard.map((x) => x.url)).toEqual(["pace-w"]);
	});

	test("men's standings are untouched", () => {
		const blocks: LaxStandingBlock[] = [
			{
				conference: { name: "Patriot" },
				conf_leaderboard: [r("bucknell", 5, 3)],
			},
		];
		expect(applyStandingsFixes("lacrosse-men", "d1", 2026, blocks)).toEqual(
			blocks,
		);
	});
});
