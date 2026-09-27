import { describe, expect, test } from "bun:test";
import { normalizePost, plainText } from "../src/v1/news";

describe("v1 news", () => {
	test("plainText strips tags and decodes entities", () => {
		expect(plainText("<p>Duke &amp; UNC &#8211; Final&hellip;</p>")).toBe(
			"Duke & UNC – Final…",
		);
	});

	test("normalizePost picks featured image, category and GMT date", () => {
		const item = normalizePost({
			id: 7,
			date_gmt: "2026-09-26T14:00:00",
			link: "https://collegelacrossenews.com/x",
			title: { rendered: "Top 20 &#8217; Poll" },
			excerpt: { rendered: "<p>Week one [&hellip;]</p>" },
			_embedded: {
				author: [{ name: "CLN Staff" }],
				"wp:featuredmedia": [
					{
						source_url: "https://cdn/full.jpg",
						media_details: {
							sizes: { medium_large: { source_url: "https://cdn/ml.jpg" } },
						},
					},
				],
				"wp:term": [
					[{ taxonomy: "category", name: "Men&#8217;s DI" }],
					[{ taxonomy: "post_tag", name: "poll" }],
				],
			},
		});
		expect(item).toEqual({
			id: 7,
			title: "Top 20 ’ Poll",
			link: "https://collegelacrossenews.com/x",
			excerpt: "Week one…",
			image: "https://cdn/ml.jpg",
			publishedAt: "2026-09-26T14:00:00.000Z",
			author: "CLN Staff",
			category: "Men’s DI",
		});
	});
});

import { resetStore } from "../src/store";
import { getNews, ingestNews, normalizePushed } from "../src/v1/news";

describe("pushed news (cln-teams plugin)", () => {
	test("normalizePushed validates and cleans", () => {
		expect(
			normalizePushed({
				id: "x",
				link: "https://a",
				title: "t",
				publishedAt: "2026-01-01T00:00:00Z",
			}),
		).toBeNull();
		expect(
			normalizePushed({
				id: 5,
				link: "https://a",
				title: "t",
				publishedAt: "nope",
			}),
		).toBeNull();
		expect(
			normalizePushed({
				id: 5,
				link: "https://collegelacrossenews.com/p",
				title: "Hello &amp; <b>World</b>",
				excerpt: "<p>Short [&hellip;]</p>",
				image: "",
				publishedAt: "2026-03-01T12:00:00+00:00",
				author: "Lou",
				category: null,
			}),
		).toEqual({
			id: 5,
			link: "https://collegelacrossenews.com/p",
			title: "Hello & World",
			excerpt: "Short…",
			image: null,
			publishedAt: "2026-03-01T12:00:00.000Z",
			author: "Lou",
			category: null,
		});
	});

	test("ingest then getNews serves pushed posts newest first, honours remove", async () => {
		resetStore();
		const base = { link: "https://collegelacrossenews.com/p", title: "T" };
		const r = await ingestNews({
			posts: [
				{ ...base, id: 1, publishedAt: "2026-01-01T00:00:00Z" },
				{ ...base, id: 2, publishedAt: "2026-02-01T00:00:00Z" },
				{ id: 3 },
			],
		});
		expect(r).toEqual({ upserted: 2, removed: 0 });
		let served = await getNews();
		expect(served.stale).toBe(false);
		expect(served.data.map((p) => p.id)).toEqual([2, 1]);
		await ingestNews({ remove: [2] });
		served = await getNews();
		expect(served.data.map((p) => p.id)).toEqual([1]);
	});
});
