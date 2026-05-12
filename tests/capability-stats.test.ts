/**
 * Tests for M013.1 (persistence) and M013.2 (Thompson Sampling math).
 *
 * The convergence test seeds a deterministic RNG so the run is
 * reproducible across CI machines.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapabilityStats, sampleBeta } from "../src/core/capability-stats";

function mulberry32(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

describe("CapabilityStats — M013.1 persistence", () => {
	let dir: string;
	let statsFile: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "apohara-capstats-"));
		statsFile = join(dir, "capability-stats.json");
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("starts empty and persists a single update", async () => {
		const stats = new CapabilityStats(statsFile);
		expect(await stats.all()).toEqual([]);

		await stats.update("groq", "codegen", true);
		const entries = await stats.all();
		expect(entries.length).toBe(1);
		expect(entries[0].provider).toBe("groq");
		expect(entries[0].role).toBe("codegen");
		expect(entries[0].successes).toBe(1);
		expect(entries[0].failures).toBe(0);

		// The on-disk file mirrors the in-memory state.
		const raw = JSON.parse(await readFile(statsFile, "utf-8"));
		expect(raw.version).toBe(1);
		expect(raw.entries.length).toBe(1);
		expect(raw.entries[0].provider).toBe("groq");
		expect(raw.entries[0].successes).toBe(1);
	});

	it("survives reload from the same file (M013.1 verify gate)", async () => {
		const s1 = new CapabilityStats(statsFile);
		await s1.update("deepseek", "codegen", true);
		await s1.update("deepseek", "codegen", true);
		await s1.update("deepseek", "codegen", false);
		await s1.update("groq", "planning", true);

		const s2 = new CapabilityStats(statsFile);
		const ds = await s2.get("deepseek", "codegen");
		expect(ds).toBeDefined();
		expect(ds?.successes).toBe(2);
		expect(ds?.failures).toBe(1);

		const groq = await s2.get("groq", "planning");
		expect(groq?.successes).toBe(1);
		expect(groq?.failures).toBe(0);
	});

	it("ignores an unreadable stats file and starts fresh", async () => {
		// Write garbage. The store should NOT crash; it should log a
		// warning and treat the in-memory map as empty.
		await Bun.write(statsFile, "definitely-not-json");
		const stats = new CapabilityStats(statsFile);
		expect(await stats.all()).toEqual([]);
		// Subsequent updates work normally + overwrite the garbage.
		await stats.update("groq", "research", true);
		const raw = JSON.parse(await readFile(statsFile, "utf-8"));
		expect(raw.entries.length).toBe(1);
	});
});

describe("sampleBeta — M013.2 Thompson Sampling math", () => {
	it("Beta(1, 1) draws cover (0, 1) roughly uniformly", () => {
		const rng = mulberry32(42);
		const draws = Array.from({ length: 2000 }, () => sampleBeta(1, 1, rng));

		// Uniform mean ~0.5, std ~1/sqrt(12) ≈ 0.289.
		const mean = draws.reduce((s, x) => s + x, 0) / draws.length;
		expect(mean).toBeGreaterThan(0.45);
		expect(mean).toBeLessThan(0.55);

		// At least one draw in each decile.
		const buckets = new Array<number>(10).fill(0);
		for (const x of draws) buckets[Math.min(9, Math.floor(x * 10))]++;
		for (let i = 0; i < 10; i++) {
			expect(buckets[i]).toBeGreaterThan(50);
		}
	});

	it("Beta(α, β) concentrates near α/(α+β) for large counts", () => {
		const rng = mulberry32(7);
		// Beta(80, 20): mean = 0.8, std = sqrt(αβ / ((α+β)²(α+β+1)))
		//                                ≈ sqrt(0.001584) ≈ 0.0398
		const draws = Array.from({ length: 2000 }, () => sampleBeta(80, 20, rng));
		const mean = draws.reduce((s, x) => s + x, 0) / draws.length;
		expect(mean).toBeGreaterThan(0.78);
		expect(mean).toBeLessThan(0.82);
		// The 1st percentile of Beta(80, 20) is around 0.69 — every
		// draw should be comfortably above 0.5.
		const minDraw = draws.reduce((m, x) => Math.min(m, x), 1);
		expect(minDraw).toBeGreaterThan(0.5);
	});

	it("rejects non-positive shapes", () => {
		expect(() => sampleBeta(0, 1)).toThrow();
		expect(() => sampleBeta(1, -3)).toThrow();
	});
});

describe("CapabilityStats.rank — M013.2 + M013.5 ranking", () => {
	let dir: string;
	let statsFile: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "apohara-capstats-"));
		statsFile = join(dir, "capability-stats.json");
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it(
		"after enough trials, the highest-success provider tops the ranking " +
			"in expectation (Thompson Sampling convergence)",
		async () => {
			const stats = new CapabilityStats(statsFile);

			// Provider A: 80/100 wins. Provider B: 30/100. Provider C: 50/100.
			// In a sampled ranking, A should be first more than half the
			// time and never below ~70% of the trials.
			for (let i = 0; i < 80; i++)
				await stats.update("a-prov" as never, "codegen", true);
			for (let i = 0; i < 20; i++)
				await stats.update("a-prov" as never, "codegen", false);
			for (let i = 0; i < 30; i++)
				await stats.update("b-prov" as never, "codegen", true);
			for (let i = 0; i < 70; i++)
				await stats.update("b-prov" as never, "codegen", false);
			for (let i = 0; i < 50; i++)
				await stats.update("c-prov" as never, "codegen", true);
			for (let i = 0; i < 50; i++)
				await stats.update("c-prov" as never, "codegen", false);

			const rng = mulberry32(123);
			let aFirst = 0;
			const trials = 400;
			for (let i = 0; i < trials; i++) {
				const ranking = await stats.rank(
					["a-prov" as never, "b-prov" as never, "c-prov" as never],
					"codegen",
					rng,
				);
				if (ranking[0].provider === ("a-prov" as never)) aFirst++;
			}

			// With 80/20 vs 30/70 vs 50/50 the dominant arm should top the
			// ranking the vast majority of the time. We use a loose
			// threshold (≥ 70%) so test flake is impossible at this
			// seed; in practice Thompson sampling lands ~95% here.
			expect(aFirst / trials).toBeGreaterThan(0.7);
		},
	);
});
