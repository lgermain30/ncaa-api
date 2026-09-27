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
