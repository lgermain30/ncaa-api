import { describe, expect, test } from "bun:test";
import { indexTeams, resolve } from "../src/v1/teams";

const board = indexTeams([
	{
		id: "florida-southern-w",
		name: "Florida Southern",
		seoName: "fla-southern",
	},
	{
		id: "southern-new-hampshire-w",
		name: "Southern New Hampshire",
		seoName: "southern-nh",
	},
	{ id: "flagler-w", name: "Flagler", seoName: "flagler" },
]);

describe("resolve", () => {
	test("finds a team by its NCAA seoName when it abbreviates the name", () => {
		expect(resolve(board, "fla-southern")).toBe("florida-southern-w");
		expect(resolve(board, "southern-nh")).toBe("southern-new-hampshire-w");
	});
	test("still resolves ids and names", () => {
		expect(resolve(board, "flagler-w")).toBe("flagler-w");
		expect(resolve(board, "Florida Southern")).toBe("florida-southern-w");
	});
});
