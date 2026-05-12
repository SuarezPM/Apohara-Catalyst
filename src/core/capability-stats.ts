/**
 * Capability stats — runtime success/failure counts per (provider, role).
 *
 * M013.1 (persist counts) + M013.2 (Thompson Sampling math) + M013.5
 * (the `apohara stats` rankings) all share this module. M013.3 (wiring
 * into ProviderRouter) and M013.4 (kv_share_friendliness dimension) are
 * follow-ups that consume this surface; the surface itself ships now so
 * the data-collection path can run before the router starts using it.
 *
 * Storage: a JSON file under `.apohara/capability-stats.json`. The
 * ROADMAP calls for `redb` so the on-disk format survives daemon
 * restarts; until the indexer daemon owns this state, a flat JSON file
 * is both sufficient and cheaper to debug. Migration to redb later only
 * changes [`load`]/[`save`].
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { roleToTaskType, type TaskType } from "./capability-manifest";
import type { ProviderId, TaskRole } from "./types";

const STATS_FILENAME = ".apohara/capability-stats.json";
const STATS_VERSION = 1;

/**
 * Beta-distribution prior. α=2, β=2 is a weakly-informative prior that
 * means "we believe success is ~50/50 with about as much confidence as
 * a single observation each way". Tunable per-deployment via
 * `APOHARA_CAPABILITY_PRIOR_ALPHA` / `APOHARA_CAPABILITY_PRIOR_BETA`.
 */
function priorAlpha(): number {
	const v = Number(process.env.APOHARA_CAPABILITY_PRIOR_ALPHA);
	return Number.isFinite(v) && v > 0 ? v : 2;
}
function priorBeta(): number {
	const v = Number(process.env.APOHARA_CAPABILITY_PRIOR_BETA);
	return Number.isFinite(v) && v > 0 ? v : 2;
}

/** A single (provider, role) bucket. */
export interface CapabilityCounts {
	provider: ProviderId;
	role: TaskType;
	successes: number;
	failures: number;
	lastUpdated: string;
}

interface StatsFile {
	version: number;
	updatedAt: string;
	entries: CapabilityCounts[];
}

function keyOf(provider: ProviderId, role: TaskType): string {
	return `${provider}|${role}`;
}

/**
 * In-memory store backed by a JSON file. Construct once per process and
 * share — concurrent writes from the same process are serialized through
 * an internal queue so the on-disk file never tears.
 */
export class CapabilityStats {
	private filePath: string;
	private map = new Map<string, CapabilityCounts>();
	private writeQueue: Promise<void> = Promise.resolve();
	private loaded = false;

	constructor(filePath?: string) {
		this.filePath = filePath ?? join(process.cwd(), STATS_FILENAME);
	}

	/** Lazy load on first use. Safe to call repeatedly. */
	private async ensureLoaded(): Promise<void> {
		if (this.loaded) return;
		try {
			const text = await readFile(this.filePath, "utf-8");
			const parsed = JSON.parse(text) as StatsFile;
			for (const e of parsed.entries ?? []) {
				this.map.set(keyOf(e.provider, e.role), e);
			}
		} catch (e) {
			// Missing file or malformed JSON → start with an empty store.
			if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
				// We don't want to silently nuke a corrupt file; log to
				// stderr and continue with an empty store.
				console.warn(
					`capability-stats: ignoring unreadable ${this.filePath}: ${
						(e as Error).message
					}`,
				);
			}
		}
		this.loaded = true;
	}

	/** Persist current state. Serialized through the write queue. */
	private flush(): Promise<void> {
		this.writeQueue = this.writeQueue.then(async () => {
			await mkdir(dirname(this.filePath), { recursive: true });
			const payload: StatsFile = {
				version: STATS_VERSION,
				updatedAt: new Date().toISOString(),
				entries: [...this.map.values()],
			};
			await writeFile(this.filePath, JSON.stringify(payload, null, 2), "utf-8");
		});
		return this.writeQueue;
	}

	/**
	 * Record a single outcome.
	 *
	 * @param provider — the provider that handled the call.
	 * @param role — the task type the call was for.
	 * @param success — true on a successful + verified completion.
	 */
	public async update(
		provider: ProviderId,
		role: TaskType,
		success: boolean,
	): Promise<void> {
		await this.ensureLoaded();
		const k = keyOf(provider, role);
		const existing = this.map.get(k) ?? {
			provider,
			role,
			successes: 0,
			failures: 0,
			lastUpdated: new Date(0).toISOString(),
		};
		if (success) existing.successes += 1;
		else existing.failures += 1;
		existing.lastUpdated = new Date().toISOString();
		this.map.set(k, existing);
		await this.flush();
	}

	/**
	 * Same as [`update`] but accepts the high-level [`TaskRole`] used by
	 * the router (research/planning/execution/verification) and maps it
	 * to the lower-level [`TaskType`] before recording. This is the entry
	 * point the routing path uses so call sites stay in role vocabulary.
	 */
	public async updateOutcome(
		provider: ProviderId,
		role: TaskRole,
		success: boolean,
	): Promise<void> {
		await this.update(provider, roleToTaskType(role), success);
	}

	/** Read the raw counts for a single (provider, role). */
	public async get(
		provider: ProviderId,
		role: TaskType,
	): Promise<CapabilityCounts | undefined> {
		await this.ensureLoaded();
		return this.map.get(keyOf(provider, role));
	}

	/** Read the raw counts for every entry. */
	public async all(): Promise<CapabilityCounts[]> {
		await this.ensureLoaded();
		return [...this.map.values()];
	}

	/**
	 * Sample a Thompson-Sampling score for the given (provider, role).
	 * The returned value is a draw from `Beta(α₀ + successes, β₀ + failures)`
	 * — higher draws mean "more promising right now".
	 *
	 * Callers pick the provider with the highest sampled score and the
	 * Beta variance does the explore/exploit balancing automatically.
	 */
	public async sample(
		provider: ProviderId,
		role: TaskType,
		rng: () => number = Math.random,
	): Promise<number> {
		await this.ensureLoaded();
		const c = this.map.get(keyOf(provider, role));
		const a = priorAlpha() + (c?.successes ?? 0);
		const b = priorBeta() + (c?.failures ?? 0);
		return sampleBeta(a, b, rng);
	}

	/**
	 * Rank a set of candidate providers for a role by sampling each one
	 * independently. Ties are broken by the raw success rate so
	 * deterministic test runs don't depend on the rng seed alone.
	 *
	 * Returns the candidates sorted descending by sampled score.
	 */
	public async rank(
		candidates: ProviderId[],
		role: TaskType,
		rng: () => number = Math.random,
	): Promise<{ provider: ProviderId; score: number; rate: number }[]> {
		await this.ensureLoaded();
		return candidates
			.map((provider) => {
				const c = this.map.get(keyOf(provider, role));
				const a = priorAlpha() + (c?.successes ?? 0);
				const b = priorBeta() + (c?.failures ?? 0);
				const score = sampleBeta(a, b, rng);
				const n = (c?.successes ?? 0) + (c?.failures ?? 0);
				const rate = n === 0 ? 0.5 : (c?.successes ?? 0) / n;
				return { provider, score, rate };
			})
			.sort((a, b) => b.score - a.score || b.rate - a.rate);
	}
}

/**
 * Process-wide default store. The router calls this on every routing
 * decision; a per-call `new CapabilityStats()` would re-read the JSON
 * file each time, so we cache one instance per file path.
 *
 * When `filePath` is not supplied, falls back to
 * `APOHARA_CAPABILITY_STATS_PATH` for test isolation, then to the
 * CapabilityStats constructor default (`<cwd>/.apohara/capability-stats.json`).
 */
let _defaultStats: CapabilityStats | undefined;
let _defaultStatsPath: string | undefined;
export function getDefaultStats(filePath?: string): CapabilityStats {
	const resolved = filePath ?? process.env.APOHARA_CAPABILITY_STATS_PATH;
	if (_defaultStats && _defaultStatsPath === resolved) return _defaultStats;
	_defaultStats = new CapabilityStats(resolved);
	_defaultStatsPath = resolved;
	return _defaultStats;
}

/**
 * Reset the default store. Test-only: lets tests point the singleton at
 * a fresh tmp file between runs without leaking state across cases.
 */
export function _resetDefaultStats(): void {
	_defaultStats = undefined;
	_defaultStatsPath = undefined;
}

/**
 * Sample from a Beta(α, β) distribution.
 *
 * Implemented via the standard "two Gamma draws" identity:
 *
 *     X ~ Gamma(α, 1), Y ~ Gamma(β, 1)
 *     Beta(α, β) = X / (X + Y)
 *
 * Gamma is sampled with the Marsaglia–Tsang method, which is exact for
 * shape ≥ 1 and uses the standard `α'=α+1` rescaling trick for shape < 1.
 * No external numerical library; precision is more than enough for
 * Thompson Sampling decisions.
 */
export function sampleBeta(
	alpha: number,
	beta: number,
	rng: () => number = Math.random,
): number {
	if (alpha <= 0 || beta <= 0) {
		throw new Error(
			`sampleBeta: α and β must be > 0, got α=${alpha} β=${beta}`,
		);
	}
	const x = sampleGamma(alpha, rng);
	const y = sampleGamma(beta, rng);
	return x / (x + y);
}

function sampleGamma(shape: number, rng: () => number): number {
	if (shape < 1) {
		// Boost shape into the >=1 regime; deflate the result.
		const u = rng();
		// Guard against rng() returning 0 (very rare with Math.random
		// but not impossible). log(0) → -Infinity → NaN downstream.
		const safeU = u === 0 ? Number.MIN_VALUE : u;
		return sampleGamma(shape + 1, rng) * safeU ** (1 / shape);
	}
	const d = shape - 1 / 3;
	const c = 1 / Math.sqrt(9 * d);
	while (true) {
		let x: number;
		let v: number;
		do {
			x = sampleStandardNormal(rng);
			v = 1 + c * x;
		} while (v <= 0);
		v = v * v * v;
		const u = rng();
		if (u < 1 - 0.0331 * x * x * x * x) return d * v;
		if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) {
			return d * v;
		}
	}
}

function sampleStandardNormal(rng: () => number): number {
	// Box–Muller. Two uniform draws → two N(0,1) draws; we use the first
	// and discard the second (cheap, perfectly correct).
	let u = rng();
	if (u === 0) u = Number.MIN_VALUE;
	const v = rng();
	return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
