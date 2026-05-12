/**
 * M013.3 + M013.4 — Thompson Sampling wired into the routing path, with
 * `provider_outcome` events on the EventLedger.
 *
 * Acceptance criteria these tests cover (from the brief):
 *  1. Routing changes provider after N failures (convergence).
 *  2. 5% exploration traffic verifiable over a sample of routes.
 *  3. `capability-stats.json` persists between runs.
 */

import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { _setRouterRng, routeTask } from "../src/core/agent-router";
import {
	_resetDefaultStats,
	CapabilityStats,
	getDefaultStats,
} from "../src/core/capability-stats";
import { EventLedger, PROVIDER_OUTCOME_EVENT } from "../src/core/ledger";
import type { EventLog } from "../src/core/types";

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

// validateToken() reads process.env at call time, so setting keys in
// beforeAll is enough to make `groq` / `deepseek` / `openai` valid
// candidates in the routing universe.
beforeAll(() => {
	process.env.NODE_ENV = "test";
	process.env.GROQ_API_KEY = "test-groq-key";
	process.env.DEEPSEEK_API_KEY = "test-deepseek-key";
	process.env.OPENAI_API_KEY = "test-openai-key";
	process.env.GEMINI_API_KEY = "test-gemini-key";
});

describe("CapabilityStats.updateOutcome — M013.3 role→type mapping", () => {
	let dir: string;
	let statsFile: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "apohara-router-thompson-"));
		statsFile = join(dir, "capability-stats.json");
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("maps TaskRole 'execution' to TaskType 'codegen' on disk", async () => {
		const stats = new CapabilityStats(statsFile);
		await stats.updateOutcome("groq", "execution", true);
		await stats.updateOutcome("groq", "execution", true);
		await stats.updateOutcome("groq", "execution", false);

		const entry = await stats.get("groq", "codegen");
		expect(entry?.successes).toBe(2);
		expect(entry?.failures).toBe(1);

		// And it does NOT silently store under the literal 'execution' bucket.
		const wrong = await stats.get("groq", "execution" as never);
		expect(wrong).toBeUndefined();
	});

	it("preserves TaskRole 'verification' as TaskType 'verification'", async () => {
		const stats = new CapabilityStats(statsFile);
		await stats.updateOutcome("openai", "verification", true);

		const entry = await stats.get("openai", "verification");
		expect(entry?.successes).toBe(1);
		expect(entry?.failures).toBe(0);
	});

	it("persists updateOutcome counts across a reload (M013.1 contract)", async () => {
		const s1 = new CapabilityStats(statsFile);
		await s1.updateOutcome("deepseek", "execution", true);
		await s1.updateOutcome("deepseek", "execution", true);
		await s1.updateOutcome("deepseek", "execution", false);

		const s2 = new CapabilityStats(statsFile);
		const reloaded = await s2.get("deepseek", "codegen");
		expect(reloaded?.successes).toBe(2);
		expect(reloaded?.failures).toBe(1);

		// And the on-disk JSON matches.
		const raw = JSON.parse(await readFile(statsFile, "utf-8"));
		expect(raw.entries.length).toBe(1);
		expect(raw.entries[0].provider).toBe("deepseek");
		expect(raw.entries[0].role).toBe("codegen");
		expect(raw.entries[0].successes).toBe(2);
	});
});

describe("routeTask — M013.3 Thompson Sampling integration", () => {
	let dir: string;
	let statsFile: string;
	let prevStatsPath: string | undefined;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "apohara-route-"));
		statsFile = join(dir, "capability-stats.json");
		prevStatsPath = process.env.APOHARA_CAPABILITY_STATS_PATH;
		process.env.APOHARA_CAPABILITY_STATS_PATH = statsFile;
		_resetDefaultStats();
		_setRouterRng(undefined);
	});

	afterEach(async () => {
		_setRouterRng(undefined);
		_resetDefaultStats();
		if (prevStatsPath === undefined)
			delete process.env.APOHARA_CAPABILITY_STATS_PATH;
		else process.env.APOHARA_CAPABILITY_STATS_PATH = prevStatsPath;
		await rm(dir, { recursive: true, force: true });
	});

	it("returns a valid token-validated provider when stats are empty", async () => {
		// Greedy seed (epsilon=0.05 default; rng=0.99 keeps us in exploit).
		_setRouterRng(() => 0.99);
		const result = await routeTask("execution", { id: "empty-stats" });
		expect(result.provider).toBeDefined();
		expect(typeof result.provider).toBe("string");
		// Exploration path is gated on rng < 0.05; 0.99 keeps us greedy.
		expect(result.explored).toBe(false);
	});

	it("after biasing stats heavily for groq on execution, routing converges to groq", async () => {
		const stats = getDefaultStats();
		for (let i = 0; i < 80; i++)
			await stats.updateOutcome("groq", "execution", true);
		// Punish a known-otherwise-strong arm to make the bias decisive.
		for (let i = 0; i < 60; i++)
			await stats.updateOutcome("deepseek-v4", "execution", false);

		// Deterministic exploit-only rng: every draw above the epsilon
		// gate so we never hit the random branch.
		_setRouterRng(mulberry32(0xc0ffee));
		// Skip past the first epsilon draws — guarantee greedy via env.
		process.env.APOHARA_ROUTER_EXPLORATION_RATE = "0";

		let groqCount = 0;
		const trials = 100;
		for (let i = 0; i < trials; i++) {
			const r = await routeTask("execution", { id: `conv-${i}` });
			if (r.provider === "groq") groqCount++;
		}
		delete process.env.APOHARA_ROUTER_EXPLORATION_RATE;
		expect(groqCount / trials).toBeGreaterThan(0.7);
	});

	it("5% exploration: ~5% of routes report explored=true (acceptance #2)", async () => {
		// Seed an arm so the greedy branch is well-defined; the
		// exploration count is independent of which arm leads.
		const stats = getDefaultStats();
		for (let i = 0; i < 40; i++)
			await stats.updateOutcome("groq", "execution", true);

		_setRouterRng(mulberry32(0x5eed));
		let explored = 0;
		const trials = 1000;
		for (let i = 0; i < trials; i++) {
			const r = await routeTask("execution", { id: `expl-${i}` });
			if (r.explored) explored++;
		}
		const rate = explored / trials;
		// 95% CI for Binomial(1000, 0.05) is ~3.6%–6.4%; loose 2–10% bound
		// gives a Z-score of ~3.5 against flake under any rng seed.
		expect(rate).toBeGreaterThan(0.02);
		expect(rate).toBeLessThan(0.1);
	});
});

describe("EventLedger.logProviderOutcome — M013.4", () => {
	let dir: string;
	let filePath: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "apohara-outcome-ledger-"));
		filePath = join(dir, "run-outcome.jsonl");
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("writes a hash-chained provider_outcome event that verify() accepts", async () => {
		const ledger = new EventLedger("outcome-run", { filePath });
		await ledger.logProviderOutcome("groq", "execution", true, {
			taskId: "T-001",
		});

		const lines = (await readFile(filePath, "utf-8"))
			.split("\n")
			.filter(Boolean)
			.map((l) => JSON.parse(l) as EventLog);
		expect(lines.length).toBe(2); // genesis + outcome
		const outcome = lines[1];
		expect(outcome.type).toBe(PROVIDER_OUTCOME_EVENT);
		expect(outcome.payload.provider).toBe("groq");
		expect(outcome.payload.role).toBe("execution");
		expect(outcome.payload.success).toBe(true);
		expect(typeof outcome.hash).toBe("string");
		expect(outcome.prev_hash).toBe(lines[0].hash);

		const v = await EventLedger.verify(filePath);
		expect(v.ok).toBe(true);
	});

	it("keeps the chain valid when mixed with other event types", async () => {
		const ledger = new EventLedger("mixed-run", { filePath });
		await ledger.log("role_assignment", { role: "planning" }, "info");
		await ledger.logProviderOutcome("openai", "planning", true);
		await ledger.logProviderOutcome("openai", "planning", false, {
			errorReason: "429 rate limit",
		});

		const v = await EventLedger.verify(filePath);
		expect(v.ok).toBe(true);
		if (v.ok) expect(v.events).toBe(4); // genesis + 3

		const lines = (await readFile(filePath, "utf-8"))
			.split("\n")
			.filter(Boolean)
			.map((l) => JSON.parse(l) as EventLog);
		const outcomes = lines.filter((l) => l.type === PROVIDER_OUTCOME_EVENT);
		expect(outcomes.length).toBe(2);
		expect(outcomes[0].severity).toBe("info");
		expect(outcomes[1].severity).toBe("warning");
		expect(outcomes[1].payload.errorReason).toBe("429 rate limit");
	});
});
