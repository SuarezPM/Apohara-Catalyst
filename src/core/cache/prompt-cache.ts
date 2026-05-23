/**
 * Multi-tier prompt-cache hit tracker (G5.I.8 — claude-octopus inspiration).
 *
 * Anthropic's Claude API exposes prompt caching at three granularities and
 * the official guidance is to push cache-hit rate as high as possible per
 * tier. The numbers we report back to the UI / telemetry are:
 *
 *   - full        : the whole prompt (system + tools + messages) was a hit
 *   - system-only : just the long-lived system block hit
 *   - tools-only  : just the tool-schemas block hit
 *
 * This module is a pure in-memory accountant: callers `record()` a result
 * keyed by `(provider, promptHash, tier)` and read `stats()` whenever they
 * want a snapshot. We don't push to telemetry from here — that's the caller's
 * job (Apohara's telemetry pipeline is opt-in per spec §0).
 *
 * The accountant also exposes `getCachedResponse()` / `setCachedResponse()`
 * so callers can plug a small response cache on top of the same key
 * machinery (LRU-style cap defaults to 256 entries to bound memory).
 */

import { createHash } from "node:crypto";

export type CacheTier = "full" | "system-only" | "tools-only";
export const CACHE_TIERS: readonly CacheTier[] = [
	"full",
	"system-only",
	"tools-only",
] as const;

export interface CacheEvent {
	provider: string;
	promptHash: string;
	tier: CacheTier;
	hit: boolean;
}

export interface CacheTierStats {
	hits: number;
	misses: number;
	hitRate: number;
}

export interface CacheStats {
	totalHits: number;
	totalMisses: number;
	byTier: Record<CacheTier, CacheTierStats>;
	byProvider: Record<string, Record<CacheTier, CacheTierStats>>;
}

export interface PromptCache {
	record(event: CacheEvent): void;
	stats(): CacheStats;
	reset(): void;
	/** Stable hash for an arbitrary string — exported so callers and tests
	 * use the same algorithm. */
	hash(input: string): string;
	getCachedResponse(provider: string, promptHash: string): string | undefined;
	setCachedResponse(
		provider: string,
		promptHash: string,
		response: string,
	): void;
}

interface PromptCacheOptions {
	/** Max stored responses before LRU eviction. Default 256. */
	maxResponses?: number;
}

function emptyTierStats(): CacheTierStats {
	return { hits: 0, misses: 0, hitRate: 0 };
}

function emptyTiers(): Record<CacheTier, CacheTierStats> {
	return {
		full: emptyTierStats(),
		"system-only": emptyTierStats(),
		"tools-only": emptyTierStats(),
	};
}

function computeHitRate(s: CacheTierStats): number {
	const total = s.hits + s.misses;
	return total === 0 ? 0 : s.hits / total;
}

/**
 * Create a fresh prompt-cache tracker. Each call returns an independent
 * tracker so tests get isolated state.
 */
export function createPromptCache(
	options: PromptCacheOptions = {},
): PromptCache {
	const maxResponses = options.maxResponses ?? 256;
	const byProvider = new Map<string, Record<CacheTier, CacheTierStats>>();
	const responses = new Map<string, string>(); // Map preserves insertion order — used as LRU.

	function tiersFor(provider: string): Record<CacheTier, CacheTierStats> {
		let entry = byProvider.get(provider);
		if (!entry) {
			entry = emptyTiers();
			byProvider.set(provider, entry);
		}
		return entry;
	}

	function record(event: CacheEvent): void {
		if (!CACHE_TIERS.includes(event.tier)) {
			throw new Error(`prompt-cache: unknown tier "${event.tier}"`);
		}
		const tiers = tiersFor(event.provider);
		const stat = tiers[event.tier];
		if (event.hit) {
			stat.hits += 1;
		} else {
			stat.misses += 1;
		}
		stat.hitRate = computeHitRate(stat);
	}

	function stats(): CacheStats {
		const out: CacheStats = {
			totalHits: 0,
			totalMisses: 0,
			byTier: emptyTiers(),
			byProvider: {},
		};
		for (const [provider, tiers] of byProvider.entries()) {
			const cloned: Record<CacheTier, CacheTierStats> = emptyTiers();
			for (const tier of CACHE_TIERS) {
				const s = tiers[tier];
				cloned[tier] = { hits: s.hits, misses: s.misses, hitRate: s.hitRate };
				out.byTier[tier].hits += s.hits;
				out.byTier[tier].misses += s.misses;
				out.totalHits += s.hits;
				out.totalMisses += s.misses;
			}
			out.byProvider[provider] = cloned;
		}
		for (const tier of CACHE_TIERS) {
			out.byTier[tier].hitRate = computeHitRate(out.byTier[tier]);
		}
		return out;
	}

	function reset(): void {
		byProvider.clear();
		responses.clear();
	}

	function hash(input: string): string {
		return createHash("sha256").update(input).digest("hex").slice(0, 32);
	}

	function responseKey(provider: string, promptHash: string): string {
		return `${provider}:${promptHash}`;
	}

	function getCachedResponse(
		provider: string,
		promptHash: string,
	): string | undefined {
		const key = responseKey(provider, promptHash);
		const v = responses.get(key);
		if (v === undefined) return undefined;
		// LRU bump: re-insert so the entry moves to the tail.
		responses.delete(key);
		responses.set(key, v);
		return v;
	}

	function setCachedResponse(
		provider: string,
		promptHash: string,
		response: string,
	): void {
		const key = responseKey(provider, promptHash);
		if (responses.has(key)) {
			responses.delete(key);
		}
		responses.set(key, response);
		while (responses.size > maxResponses) {
			const firstKey = responses.keys().next().value;
			if (firstKey === undefined) break;
			responses.delete(firstKey);
		}
	}

	return {
		record,
		stats,
		reset,
		hash,
		getCachedResponse,
		setCachedResponse,
	};
}
