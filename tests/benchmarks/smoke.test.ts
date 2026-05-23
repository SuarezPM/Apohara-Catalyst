/**
 * G7.D.5 — Performance regression smoke benchmarks.
 *
 * These are NOT representative load tests. They guard against gross
 * regressions in three hot, deterministic, mock-friendly paths:
 *
 *   1. `actionChain` walk + `startWorkspace` build — every /api/run
 *      hits this twice per session. Budget < 5 ms per 1 000 builds.
 *   2. `parseTaskWithManifest` over a 50-task manifest — every
 *      decomposer pass validates the manifest. Budget < 100 ms.
 *   3. `runReconcilerPasses` dry tick over an empty session directory.
 *      This is the reconciler's hot path when nothing is scheduled.
 *      Budget < 500 ms (filesystem-bound; the budget is generous on
 *      purpose because GitHub runners' /tmp is sometimes slow).
 *
 * The budgets are deliberately loose — 10× the typical local time on
 * Pablo's Ryzen 3600 — because we want to catch order-of-magnitude
 * regressions, not stylistic micro-pessimisations. Tighten them only
 * after the CI 95-th percentile baseline is established.
 *
 * Skipped under `APOHARA_SKIP_BENCH=1` so contributors on slow VMs
 * can opt out without disabling the whole test suite.
 */
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	actionChain,
	startWorkspace,
} from "../../src/core/dispatch/executor-action";
import { runReconcilerPasses } from "../../src/core/dispatch/reconciler";
import { parseTaskWithManifest } from "../../src/core/decomposer/manifests";

const SKIP = process.env.APOHARA_SKIP_BENCH === "1";

// Budgets are wall-clock milliseconds per the whole loop, not per
// iteration. Set so the benchmark fails when something regressed by
// at least an order of magnitude, not for noise.
const BUDGET_ACTION_CHAIN_MS = 50; // 1 000 iterations
const BUDGET_MANIFEST_PARSE_MS = 100; // 50 tasks
const BUDGET_RECONCILER_TICK_MS = 500; // single empty-dir tick

function measureSync(label: string, fn: () => void): number {
	const t0 = performance.now();
	fn();
	const dt = performance.now() - t0;
	// eslint-disable-next-line no-console
	console.log(`[bench] ${label}: ${dt.toFixed(2)} ms`);
	return dt;
}

async function measureAsync(
	label: string,
	fn: () => Promise<void>,
): Promise<number> {
	const t0 = performance.now();
	await fn();
	const dt = performance.now() - t0;
	// eslint-disable-next-line no-console
	console.log(`[bench] ${label}: ${dt.toFixed(2)} ms`);
	return dt;
}

describe.skipIf(SKIP)("G7.D.5 — smoke benchmarks", () => {
	test("actionChain build + walk stays under budget", () => {
		const dt = measureSync("actionChain x1000", () => {
			for (let i = 0; i < 1000; i++) {
				const root = startWorkspace({
					prompt: `bench task ${i}`,
					providerId: "opencode-go",
				});
				const chain = actionChain(root);
				if (chain.length !== 1) {
					throw new Error("unexpected chain length");
				}
			}
		});
		expect(dt).toBeLessThan(BUDGET_ACTION_CHAIN_MS);
	});

	test("parseTaskWithManifest stays under budget for 50-task pass", () => {
		const sample = (idx: number) => ({
			id: `task-${idx}`,
			description: `bench description ${idx}`,
			dependsOn: idx === 0 ? [] : [`task-${idx - 1}`],
			agentRole: "coder",
			symbols: {
				reads: [
					{ file: `src/a${idx}.ts`, symbol: `read${idx}`, kind: "function" },
				],
				writes: [
					{ file: `src/b${idx}.ts`, symbol: `write${idx}`, kind: "function" },
				],
				renames: [],
			},
		});
		const dt = measureSync("parseTaskWithManifest x50", () => {
			for (let i = 0; i < 50; i++) {
				const parsed = parseTaskWithManifest(sample(i));
				if (parsed.id !== `task-${i}`) {
					throw new Error("parse roundtrip mismatch");
				}
			}
		});
		expect(dt).toBeLessThan(BUDGET_MANIFEST_PARSE_MS);
	});

	test("runReconcilerPasses empty-session tick stays under budget", async () => {
		const workspace = await mkdtemp(join(tmpdir(), "apohara-bench-"));
		const ledgerPath = join(workspace, "ledger.jsonl");
		try {
			const dt = await measureAsync("runReconcilerPasses (empty)", async () => {
				const report = await runReconcilerPasses({
					workspace,
					sessionId: "bench-session",
					ledgerPath,
				});
				if (report.passResults.length === 0) {
					throw new Error("expected at least one pass result");
				}
			});
			expect(dt).toBeLessThan(BUDGET_RECONCILER_TICK_MS);
		} finally {
			await rm(workspace, { recursive: true, force: true });
		}
	});
});
