import { RedisClient } from "bun";
import ExpiryMap from "expiry-map";

/**
 * Two-tier response cache.
 *
 * L1: in-process ExpiryMap (sync, per instance) — the existing behaviour.
 * L2: Redis (optional, REDIS_URL) shared across instances/restarts, holding
 *     a `fresh:` copy with the route TTL and a `lastgood:` copy kept for
 *     LAST_GOOD_TTL so stale data can be served when upstream is down.
 *
 * Without REDIS_URL the last-good copy lives in a bounded in-memory map so
 * failover still works on a single instance until the process restarts.
 */

const LAST_GOOD_TTL_S =
	Number(process.env.CACHE_LAST_GOOD_TTL_SECONDS) || 7 * 24 * 60 * 60;
const KEY_PREFIX = process.env.CACHE_KEY_PREFIX ?? "ncaa-api";
const MEMORY_LAST_GOOD_MAX = 2000;

interface Envelope {
	v: unknown;
	at: number;
}

export interface StaleEntry {
	value: unknown;
	ageSeconds: number;
}

export const cacheStats = {
	backend: "memory" as "memory" | "redis",
	redisConnected: false,
	redisErrors: 0,
	lastRedisError: null as string | null,
	staleServed: 0,
};

let redis: RedisClient | null = null;

if (process.env.REDIS_URL) {
	cacheStats.backend = "redis";
	redis = new RedisClient(process.env.REDIS_URL, {
		connectionTimeout: 5000,
		autoReconnect: true,
		maxRetries: 20,
		enableOfflineQueue: false,
	});
	redis.onconnect = () => {
		cacheStats.redisConnected = true;
	};
	redis.onclose = (err) => {
		cacheStats.redisConnected = false;
		noteRedisError(err);
	};
	redis.connect().catch(noteRedisError);
}

function noteRedisError(err: unknown) {
	cacheStats.redisErrors++;
	cacheStats.lastRedisError = err instanceof Error ? err.message : String(err);
}

async function redisGet(key: string): Promise<Envelope | null> {
	if (!redis || !cacheStats.redisConnected) return null;
	try {
		const raw = await redis.get(key);
		return raw ? (JSON.parse(raw) as Envelope) : null;
	} catch (err) {
		noteRedisError(err);
		return null;
	}
}

function redisSet(key: string, envelope: Envelope, ttlSeconds: number) {
	if (!redis || !cacheStats.redisConnected) return;
	redis
		.set(key, JSON.stringify(envelope), "EX", ttlSeconds)
		.catch(noteRedisError);
}

/** last-good fallback when Redis is not configured */
const memoryLastGood = new Map<string, Envelope>();

function rememberLastGood(key: string, envelope: Envelope) {
	if (redis) {
		redisSet(`${KEY_PREFIX}:lastgood:${key}`, envelope, LAST_GOOD_TTL_S);
		return;
	}
	memoryLastGood.delete(key);
	memoryLastGood.set(key, envelope);
	if (memoryLastGood.size > MEMORY_LAST_GOOD_MAX) {
		const oldest = memoryLastGood.keys().next().value;
		if (oldest !== undefined) memoryLastGood.delete(oldest);
	}
}

export class TieredCache {
	readonly name: string;
	readonly ttlMs: number;
	private readonly l1: ExpiryMap<string, unknown>;

	constructor(name: string, ttlMs: number) {
		this.name = name;
		this.ttlMs = ttlMs;
		this.l1 = new ExpiryMap(ttlMs);
	}

	has(key: string) {
		return this.l1.has(key);
	}

	get(key: string) {
		return this.l1.get(key);
	}

	/** Drop the fresh in-process copy (last-good is kept). */
	evict(key: string) {
		this.l1.delete(key);
	}

	/** Store a fresh value in L1 and (when configured) Redis fresh + last-good. */
	set(key: string, value: unknown) {
		this.l1.set(key, value);
		const envelope: Envelope = { v: value, at: Date.now() };
		redisSet(
			`${KEY_PREFIX}:fresh:${this.name}:${key}`,
			envelope,
			Math.ceil(this.ttlMs / 1000),
		);
		rememberLastGood(key, envelope);
	}

	/** Fresh value from Redis (populates L1 on hit). Only meaningful with REDIS_URL. */
	async getShared(key: string): Promise<unknown | undefined> {
		const hit = await redisGet(`${KEY_PREFIX}:fresh:${this.name}:${key}`);
		if (!hit) return undefined;
		this.l1.set(key, hit.v);
		return hit.v;
	}

	/** Most recent successful value regardless of freshness, for failover. */
	async getStale(key: string): Promise<StaleEntry | null> {
		const envelope = redis
			? await redisGet(`${KEY_PREFIX}:lastgood:${key}`)
			: memoryLastGood.get(key);
		if (!envelope) return null;
		return {
			value: envelope.v,
			ageSeconds: Math.round((Date.now() - envelope.at) / 1000),
		};
	}
}

export async function pingRedis(): Promise<boolean> {
	if (!redis || !cacheStats.redisConnected) return false;
	try {
		return (await redis.ping()) === "PONG";
	} catch (err) {
		noteRedisError(err);
		return false;
	}
}
