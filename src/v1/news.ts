import { TieredCache } from "../cache";
import { UpstreamError, upstreamFetch } from "../upstream";
import type { Served } from "./service";

/*
 * CLN headlines for the mobile News tab, read from the WordPress REST API of
 * collegelacrossenews.com (the same posts that feed the home page).
 */

const WP_POSTS =
	process.env.CLN_WP_POSTS_URL ??
	"https://collegelacrossenews.com/wp-json/wp/v2/posts";
const PER_PAGE = 30;
const cache = new TieredCache("cln-news", 5 * 60 * 1000);

export interface V1NewsItem {
	id: number;
	title: string;
	link: string;
	excerpt: string;
	image: string | null;
	publishedAt: string;
	author: string | null;
	category: string | null;
}

interface WpRendered {
	rendered?: string;
}
interface WpPost {
	id: number;
	date_gmt?: string;
	date?: string;
	link: string;
	title?: WpRendered;
	excerpt?: WpRendered;
	_embedded?: {
		author?: { name?: string }[];
		"wp:featuredmedia"?: {
			source_url?: string;
			media_details?: {
				sizes?: Record<string, { source_url?: string }>;
			};
		}[];
		"wp:term"?: { taxonomy?: string; name?: string }[][];
	};
}

const ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	hellip: "…",
	ndash: "–",
	mdash: "—",
	lsquo: "‘",
	rsquo: "’",
	ldquo: "“",
	rdquo: "”",
};

/** Strip tags and decode the entities WordPress emits in rendered fields. */
export function plainText(html: string | undefined): string {
	return (html ?? "")
		.replace(/<[^>]*>/g, " ")
		.replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
		.replace(/&#x([0-9a-f]+);/gi, (_, n: string) =>
			String.fromCodePoint(Number.parseInt(n, 16)),
		)
		.replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name] ?? m)
		.replace(/\s+/g, " ")
		.trim();
}

function imageOf(post: WpPost): string | null {
	const media = post._embedded?.["wp:featuredmedia"]?.[0];
	const sizes = media?.media_details?.sizes;
	return (
		sizes?.medium_large?.source_url ??
		sizes?.large?.source_url ??
		media?.source_url ??
		null
	);
}

export function normalizePost(post: WpPost): V1NewsItem {
	const category =
		post._embedded?.["wp:term"]
			?.flat()
			.find((t) => t.taxonomy === "category" && t.name)?.name ?? null;
	const published = post.date_gmt
		? `${post.date_gmt}Z`
		: (post.date ?? new Date().toISOString());
	return {
		id: post.id,
		title: plainText(post.title?.rendered),
		link: post.link,
		excerpt: plainText(post.excerpt?.rendered).replace(/\s*\[…\]$/, "…"),
		image: imageOf(post),
		publishedAt: new Date(published).toISOString(),
		author: post._embedded?.author?.[0]?.name ?? null,
		category: category ? plainText(category) : null,
	};
}

async function loadPosts(): Promise<V1NewsItem[]> {
	const url = `${WP_POSTS}?per_page=${PER_PAGE}&_embed=author,wp:featuredmedia,wp:term`;
	const res = await upstreamFetch(url, {
		headers: { Accept: "application/json" },
	});
	// SiteGround's bot check answers 202 + `sg-captcha: challenge` with an HTML
	// redirect instead of the API payload; treat it as an upstream failure so
	// the last good copy is served.
	if (!res.ok || res.headers.get("sg-captcha")) {
		throw new UpstreamError(
			`HTTP ${res.status}${res.headers.get("sg-captcha") ? " (captcha)" : ""} from ${url}`,
			url,
			res.status,
		);
	}
	const posts = (await res.json()) as WpPost[];
	return posts.filter((p) => p?.link).map(normalizePost);
}

export async function getNews(): Promise<Served<V1NewsItem[]>> {
	const key = "posts";
	const fresh = (cache.get(key) ?? (await cache.getShared(key))) as
		| V1NewsItem[]
		| undefined;
	if (fresh)
		return { data: fresh, updatedAt: new Date().toISOString(), stale: false };
	try {
		const data = await loadPosts();
		cache.set(key, data);
		return { data, updatedAt: new Date().toISOString(), stale: false };
	} catch (err) {
		const stale = await cache.getStale(key);
		if (!stale) throw err;
		return {
			data: stale.value as V1NewsItem[],
			updatedAt: new Date(Date.now() - stale.ageSeconds * 1000).toISOString(),
			stale: true,
		};
	}
}
