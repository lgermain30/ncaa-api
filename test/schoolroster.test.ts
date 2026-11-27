import { expect, test } from "bun:test";
import { fixHometownSchool, isNonPlayerRole } from "../src/v1/teams";

test("student assistants and managers listed among players are not players (Marist)", () => {
	expect(isNonPlayerRole("Student Assistant")).toBe(true);
	expect(isNonPlayerRole("Student Manager")).toBe(true);
	expect(isNonPlayerRole("Manager")).toBe(true);
	expect(isNonPlayerRole("Midfield")).toBe(false);
	expect(isNonPlayerRole("Attack/Midfield")).toBe(false);
	expect(isNonPlayerRole("LSM")).toBe(false);
	expect(isNonPlayerRole(null)).toBe(false);
});

test("hometown and high school entered in each other's column are swapped back", () => {
	expect(
		fixHometownSchool({
			hometown: "Comsewogue High School",
			highSchool: "Port Jefferson Station, N.Y.",
		}),
	).toEqual({
		hometown: "Port Jefferson Station, N.Y.",
		highSchool: "Comsewogue High School",
	});
	const ok = {
		hometown: "Mount Sinai, NY",
		highSchool: "Mount Sinai High School",
	};
	expect(fixHometownSchool(ok)).toEqual(ok);
	const both = { hometown: "School, NY", highSchool: "Chaminade High School" };
	expect(fixHometownSchool(both)).toEqual(both);
	const none = { hometown: null, highSchool: "Vestal" };
	expect(fixHometownSchool(none)).toEqual(none);
});
