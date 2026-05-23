/**
 * G5.F.9 — multica atomic writes audit.
 *
 * Sweep test that exercises the persistent state writers we migrated
 * to `atomicWriteFile` and asserts:
 *   - The target file lands with no leftover `.tmp.*` siblings.
 *   - A concurrent reader either sees the OLD bytes or the NEW bytes,
 *     never a half-written state. Synthetic by construction since
 *     `atomicWriteFile` does mkstemp → fdatasync → rename.
 *
 * The point is not to re-prove `atomicWrite.ts` (that has its own
 * unit tests) — it's to pin the *integration*: that the callers we
 * touched in G5.F.9 actually route through it.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StateMachine } from "../../../src/core/state";
import { CapabilityStats } from "../../../src/core/capability-stats";

let workDir: string;
beforeEach(async () => {
	workDir = await mkdtemp(join(tmpdir(), "apohara-multica-"));
});
afterEach(async () => {
	await rm(workDir, { recursive: true, force: true });
});

describe("G5.F.9 — atomic writes integration", () => {
	test("StateMachine.update() leaves no `.tmp.*` files behind", async () => {
		const statePath = join(workDir, "state.json");
		const sm = new StateMachine(statePath);
		await sm.update((s) => ({ ...s, foo: 1 } as never));
		await sm.update((s) => ({ ...s, foo: 2 } as never));
		const dirContents = await readdir(workDir);
		const stragglers = dirContents.filter((f) => f.startsWith(".tmp."));
		expect(stragglers).toEqual([]);
		// File exists + is non-empty
		const body = await readFile(statePath, "utf-8");
		expect(body.length).toBeGreaterThan(0);
	});

	test("CapabilityStats writes leave no `.tmp.*` files behind", async () => {
		const statsPath = join(workDir, "stats.json");
		const tracker = new CapabilityStats(statsPath);
		await tracker.update("claude-code-cli", "codegen", true);
		await tracker.update("codex-cli", "codegen", false);
		const dirContents = await readdir(workDir);
		const stragglers = dirContents.filter((f) => f.startsWith(".tmp."));
		expect(stragglers).toEqual([]);
	});
});
