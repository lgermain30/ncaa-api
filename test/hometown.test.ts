import { describe, expect, it } from "bun:test";
import { formatHometown } from "../src/v1/hometown";

describe("formatHometown", () => {
	it("turns AP-style and full state names into postal codes", () => {
		expect(formatHometown("Baltimore, Md.")).toBe("Baltimore, MD");
		expect(formatHometown("Rochester, N.Y.")).toBe("Rochester, NY");
		expect(formatHometown("Austin, Texas")).toBe("Austin, TX");
		expect(formatHometown("Darien, Conn.")).toBe("Darien, CT");
		expect(formatHometown("West Chester, Pennsylvania")).toBe(
			"West Chester, PA",
		);
		expect(formatHometown("Washington, D.C.")).toBe("Washington, DC");
	});

	it("keeps postal codes and capitalizes towns", () => {
		expect(formatHometown("Rochester, NY")).toBe("Rochester, NY");
		expect(formatHometown("rochester, ny")).toBe("Rochester, NY");
		expect(formatHometown("MOUNT SINAI, N.Y.")).toBe("Mount Sinai, NY");
		expect(formatHometown("McLean, Va.")).toBe("McLean, VA");
	});

	it("preserves international places", () => {
		expect(formatHometown("Calgary, Alberta")).toBe("Calgary, AB");
		expect(formatHometown("Abbotsford, BC, Canada")).toBe(
			"Abbotsford, BC, Canada",
		);
		expect(formatHometown("Sydney, Australia")).toBe("Sydney, Australia");
		expect(formatHometown("")).toBeNull();
		expect(formatHometown(null)).toBeNull();
	});
});
