import { getSemaphore } from "@henrygd/semaphore";

/**
 * Single choke point for every request that leaves this service (ncaa.com,
 * sdataprod.ncaa.com, stats.ncaa.org, lax.com, conference sites).
 *
 * - bounded concurrency so a burst of clients can't fan out into hundreds of
 *   simultaneous upstream requests
 * - per-request timeout
 * - retry with exponential backoff + jitter on network errors, 429 and 5xx
 * - realistic browser User-Agent
 * - health counters exposed via /health
 */

const DEFAULT_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS) || 10_000;
const DEFAULT_RETRIES = Number(process.env.UPSTREAM_RETRIES ?? 2);
const CONCURRENCY = Number(process.env.UPSTREAM_CONCURRENCY) || 8;

const USER_AGENTS = [
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
];

/**
 * Hosts whose TLS chain is known to be incomplete (e.g. laxshop.com). TLS
 * verification is relaxed only for these instead of process-wide.
 */
const INSECURE_TLS_HOSTS = new Set(
	(process.env.UPSTREAM_INSECURE_TLS_HOSTS ?? "www.laxshop.com")
		.split(",")
		.map((h) => h.trim())
		.filter(Boolean),
);

function tlsOptions(url: string) {
	const host = new URL(url).hostname;
	return INSECURE_TLS_HOSTS.has(host)
		? { rejectUnauthorized: false }
		: undefined;
}

const semaphore = getSemaphore("upstream-fetch", CONCURRENCY);

/**
 * Per-host circuit breaker: after BREAKER_THRESHOLD consecutive failures the
 * host is skipped (fast UpstreamError) for BREAKER_COOLDOWN_MS, then a single
 * probe request is allowed through (half-open) before fully closing again.
 */
const BREAKER_THRESHOLD = Number(process.env.UPSTREAM_BREAKER_THRESHOLD) || 5;
const BREAKER_COOLDOWN_MS =
	Number(process.env.UPSTREAM_BREAKER_COOLDOWN_MS) || 30_000;

interface Breaker {
	failures: number;
	openedAt: number | null;
	probing: boolean;
}

const breakers = new Map<string, Breaker>();

function breakerFor(host: string) {
	let b = breakers.get(host);
	if (!b) {
		b = { failures: 0, openedAt: null, probing: false };
		breakers.set(host, b);
	}
	return b;
}

export function breakerState(host: string): "closed" | "open" | "half-open" {
	const b = breakers.get(host);
	if (!b || b.openedAt === null) return "closed";
	return Date.now() - b.openedAt >= BREAKER_COOLDOWN_MS ? "half-open" : "open";
}

export function openBreakers() {
	return [...breakers.keys()].filter((h) => breakerState(h) !== "closed");
}

/** test hook */
export function resetBreakers() {
	breakers.clear();
}

export interface UpstreamOptions extends RequestInit {
	/** Abort the request after this many ms. */
	timeoutMs?: number;
	/** Retries after the first attempt on 429/5xx/network error. */
	retries?: number;
}

export const upstreamStats = {
	startedAt: new Date().toISOString(),
	requests: 0,
	retries: 0,
	failures: 0,
	consecutiveFailures: 0,
	lastSuccessAt: null as string | null,
	lastFailureAt: null as string | null,
	lastError: null as string | null,
	breakerTrips: 0,
};

export class UpstreamError extends Error {
	status: number | undefined;
	url: string;
	circuitOpen: boolean;
	constructor(
		message: string,
		url: string,
		status?: number,
		circuitOpen = false,
	) {
		super(message);
		this.name = "UpstreamError";
		this.url = url;
		this.status = status;
		this.circuitOpen = circuitOpen;
	}
}

function shouldRetry(status: number) {
	return status === 429 || status === 408 || status >= 500;
}

function backoffMs(attempt: number) {
	const base = 300 * 2 ** attempt;
	return base + Math.random() * base;
}

function recordSuccess(host: string) {
	upstreamStats.lastSuccessAt = new Date().toISOString();
	upstreamStats.consecutiveFailures = 0;
	const b = breakerFor(host);
	b.failures = 0;
	b.openedAt = null;
	b.probing = false;
}

function recordFailure(host: string, err: unknown) {
	upstreamStats.failures++;
	upstreamStats.consecutiveFailures++;
	upstreamStats.lastFailureAt = new Date().toISOString();
	upstreamStats.lastError = err instanceof Error ? err.message : String(err);
	const b = breakerFor(host);
	b.failures++;
	b.probing = false;
	if (b.failures >= BREAKER_THRESHOLD) {
		b.openedAt = Date.now();
		upstreamStats.breakerTrips++;
	}
}

/**
 * fetch() with concurrency limit, timeout and retries. Resolves with the
 * Response for any status < 500 that isn't 429 (callers still check `ok`);
 * rejects with UpstreamError once retries are exhausted.
 */
export async function upstreamFetch(
	url: string,
	options: UpstreamOptions = {},
): Promise<Response> {
	const {
		timeoutMs = DEFAULT_TIMEOUT_MS,
		retries = DEFAULT_RETRIES,
		headers,
		...init
	} = options;
	const host = new URL(url).hostname;

	const breaker = breakerFor(host);
	const state = breakerState(host);
	if (state === "open" || (state === "half-open" && breaker.probing)) {
		throw new UpstreamError(`circuit open for ${host}`, url, undefined, true);
	}
	if (state === "half-open") {
		breaker.probing = true;
	}

	await semaphore.acquire();
	try {
		let lastErr: unknown;
		for (let attempt = 0; attempt <= retries; attempt++) {
			if (attempt > 0) {
				upstreamStats.retries++;
				await Bun.sleep(backoffMs(attempt - 1));
			}
			upstreamStats.requests++;
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), timeoutMs);
			try {
				const res = await fetch(url, {
					...init,
					tls: tlsOptions(url),
					signal: controller.signal,
					headers: {
						"User-Agent": USER_AGENTS[attempt % USER_AGENTS.length],
						Accept: "application/json, text/html;q=0.9, */*;q=0.8",
						...(headers as Record<string, string> | undefined),
					},
				});
				if (shouldRetry(res.status)) {
					lastErr = new UpstreamError(
						`HTTP ${res.status} from ${url}`,
						url,
						res.status,
					);
					continue;
				}
				recordSuccess(host);
				return res;
			} catch (err) {
				lastErr = err;
			} finally {
				clearTimeout(timer);
			}
		}
		recordFailure(host, lastErr);
		if (lastErr instanceof UpstreamError) {
			throw lastErr;
		}
		throw new UpstreamError(
			`${lastErr instanceof Error ? lastErr.message : String(lastErr)} (${url})`,
			url,
		);
	} finally {
		semaphore.release();
	}
}

/** upstreamFetch + JSON decode; throws UpstreamError on non-2xx. */
export async function upstreamJson<T = unknown>(
	url: string,
	options: UpstreamOptions = {},
): Promise<T> {
	const res = await upstreamFetch(url, options);
	if (!res.ok) {
		throw new UpstreamError(`HTTP ${res.status} from ${url}`, url, res.status);
	}
	return (await res.json()) as T;
}

/** Number of upstream requests currently in flight or queued. */
export function upstreamQueueSize() {
	return semaphore.size();
}
