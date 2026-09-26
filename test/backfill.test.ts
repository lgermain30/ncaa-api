import { beforeEach, describe, expect, it } from "bun:test";
import { backfillProgress } from "../src/v1/backfill";
import { v1 } from "../src/v1/routes";

describe("POST /v1/admin/backfill", () => {
	beforeEach(() => {
		delete Bun.env.NCAA_HEADER_KEY;
	});

	const body = JSON.stringify({ fromSeason: 2023, toSeason: 2023 });

	it("is forbidden without ADMIN_KEY configured", async () => {
		delete Bun.env.ADMIN_KEY;
		const res = await v1.handle(
			new Request("http://localhost/v1/admin/backfill", {
				method: "POST",
				headers: { "content-type": "application/json", "x-admin-key": "x" },
				body,
			}),
		);
		expect(res.status).toBe(403);
	});

	it("is forbidden with the wrong key", async () => {
		Bun.env.ADMIN_KEY = "secret";
		const res = await v1.handle(
			new Request("http://localhost/v1/admin/backfill", {
				method: "POST",
				headers: { "content-type": "application/json", "x-admin-key": "nope" },
				body,
			}),
		);
		expect(res.status).toBe(403);
		delete Bun.env.ADMIN_KEY;
	});

	it("validates the body", async () => {
		Bun.env.ADMIN_KEY = "secret";
		const res = await v1.handle(
			new Request("http://localhost/v1/admin/backfill", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-admin-key": "secret",
				},
				body: JSON.stringify({
					fromSeason: 2023,
					toSeason: 2023,
					sports: ["hockey"],
				}),
			}),
		);
		expect(res.status).toBe(422);
		delete Bun.env.ADMIN_KEY;
	});

	it("exposes progress on /v1/status and stops on DELETE", async () => {
		Bun.env.ADMIN_KEY = "secret";
		expect(backfillProgress.running).toBe(false);
		const status = await v1.handle(new Request("http://localhost/v1/status"));
		const json = await status.json();
		expect(json.backfill.running).toBe(false);
		const res = await v1.handle(
			new Request("http://localhost/v1/admin/backfill", {
				method: "DELETE",
				headers: { "x-admin-key": "secret" },
			}),
		);
		expect(res.status).toBe(200);
		expect((await res.json()).backfill.running).toBe(false);
		delete Bun.env.ADMIN_KEY;
	});
});
