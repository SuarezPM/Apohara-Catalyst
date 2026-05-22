/**
 * Stage 10 §10.9 — Ledger SHA chain replay-verifies after canonical projection.
 *
 * Loads a committed, real chain-verified fixture (`r-001.jsonl`) and exercises:
 *   1. EventLedger.verify() end-to-end on the untouched fixture.
 *   2. Tamper detection: mutate a middle event, re-verify, assert the failure
 *      pinpoints the tampered line (NOT the genesis or the tail).
 *   3. The `apohara replay <path> --dry-run` CLI invocation succeeds cleanly
 *      against the same fixture (chain verify + deterministic plan emission).
 *
 * The fixture is generated once (by hand) using the real EventLedger.log()
 * API and committed alongside this test so humans can inspect it and CI
 * doesn't re-emit it on every run.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildPlan } from "../../src/commands/replay";
import { EventLedger, GENESIS_PREV_HASH } from "../../src/core/ledger";
import type { EventLog } from "../../src/core/types";

const REPO_ROOT = resolve(import.meta.dir, "../..");
const FIXTURE = resolve(REPO_ROOT, "tests/fixtures/replay-runs/r-001.jsonl");
const CLI = resolve(REPO_ROOT, "src/cli.ts");

describe("Stage 10.9 — ledger SHA chain replay-verify (integration)", () => {
	let workDir: string;
	let workFixture: string;

	beforeEach(async () => {
		workDir = await mkdtemp(join(tmpdir(), "apohara-replay-int-"));
		workFixture = join(workDir, "r-001.jsonl");
		await copyFile(FIXTURE, workFixture);
	});

	afterEach(async () => {
		await rm(workDir, { recursive: true, force: true });
	});

	it("verifies the committed fixture end-to-end", async () => {
		const result = await EventLedger.verify(FIXTURE);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.legacy).toBe(false);
			// genesis + 6 logged events
			expect(result.events).toBe(7);
		}
	});

	it("buildPlan extracts the recorded llm_request events from the fixture", async () => {
		const plan = await buildPlan(FIXTURE);
		expect(plan.runId).toBe("r-001");
		expect(plan.ledgerVersion).toBe(1);
		expect(plan.totalEvents).toBe(7);
		// Fixture has exactly two llm_request events (anthropic-api, openai).
		expect(plan.llmRequests.length).toBe(2);
		expect(plan.llmRequests[0].provider).toBe("anthropic-api");
		expect(plan.llmRequests[1].provider).toBe("openai");
	});

	it("verifies the genesis block's prev_hash is the canonical zero string", async () => {
		const lines = (await readFile(FIXTURE, "utf-8"))
			.split("\n")
			.filter((l) => l.length > 0);
		const genesis = JSON.parse(lines[0]) as EventLog;
		expect(genesis.type).toBe("genesis");
		expect(genesis.prev_hash).toBe(GENESIS_PREV_HASH);
	});

	it("detects tampering in a MIDDLE event and pinpoints the broken line", async () => {
		// Tamper line index 3 (provider_outcome — neither genesis nor tail).
		const lines = (await readFile(workFixture, "utf-8"))
			.split("\n")
			.filter((l) => l.length > 0);
		expect(lines.length).toBe(7);
		const tamperIdx = 3;
		const evt = JSON.parse(lines[tamperIdx]) as EventLog;
		// Mutate the payload (success flip) — preserves shape, breaks hash.
		(evt.payload as { success: boolean }).success = false;
		lines[tamperIdx] = JSON.stringify(evt);
		await writeFile(workFixture, `${lines.join("\n")}\n`, "utf-8");

		const result = await EventLedger.verify(workFixture);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			// CRITICAL: must pinpoint the tampered event itself, not genesis
			// (idx 0) and not the tail (idx 6). This proves the verifier
			// walks the chain hash-by-hash rather than just checking endpoints.
			expect(result.brokenAt).toBe(tamperIdx);
			expect(result.reason).toContain("hash mismatch");
		}
	});

	it("detects a snapped prev_hash link in the middle of the chain", async () => {
		// Different failure mode: break the link (prev_hash) rather than the
		// payload. Verifier should report a `prev_hash` reason at the broken
		// line — proves both branches of the chain check fire.
		const lines = (await readFile(workFixture, "utf-8"))
			.split("\n")
			.filter((l) => l.length > 0);
		const tamperIdx = 4;
		const evt = JSON.parse(lines[tamperIdx]) as EventLog;
		evt.prev_hash = "0".repeat(64); // wrong link
		lines[tamperIdx] = JSON.stringify(evt);
		await writeFile(workFixture, `${lines.join("\n")}\n`, "utf-8");

		const result = await EventLedger.verify(workFixture);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.brokenAt).toBe(tamperIdx);
			expect(result.reason).toContain("prev_hash");
		}
	});

	it(
		"`apohara replay <fixture> --dry-run` verifies the chain and exits 0",
		() => {
			// --dry-run runs EventLedger.verify() (no --skip-verify) and emits
			// the deterministic plan JSON without performing provider calls.
			// This is the production path that proves the CLI's verify step
			// works against a committed canonical fixture.
			const result = spawnSync(
				"bun",
				["run", CLI, "replay", FIXTURE, "--dry-run"],
				{
					encoding: "utf-8",
					timeout: 30_000,
					cwd: REPO_ROOT,
					env: { ...process.env, NO_COLOR: "1" },
				},
			);
			const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`;
			expect(
				result.status,
				`apohara replay failed (status=${result.status}):\n${combined}`,
			).toBe(0);
			// Dry-run prints a JSON object; sanity-check its top-level shape.
			const parsed = JSON.parse(result.stdout);
			expect(parsed.runId).toBe("r-001");
			expect(parsed.ledgerVersion).toBe(1);
			expect(parsed.totalEvents).toBe(7);
			expect(parsed.llmRequests.length).toBe(2);
		},
		{ timeout: 35_000 },
	);

	it(
		"`apohara replay` exits non-zero when the chain is tampered",
		() => {
			// Same CLI path, against the tampered tmpdir copy. The verify
			// step must abort before the plan is emitted, exit code != 0,
			// and the stderr must mention the broken line.
			const lines = require("node:fs")
				.readFileSync(workFixture, "utf-8")
				.split("\n")
				.filter((l: string) => l.length > 0);
			const evt = JSON.parse(lines[2]) as EventLog;
			(evt.payload as Record<string, unknown>).model = "TAMPERED";
			lines[2] = JSON.stringify(evt);
			require("node:fs").writeFileSync(
				workFixture,
				`${lines.join("\n")}\n`,
				"utf-8",
			);

			const result = spawnSync(
				"bun",
				["run", CLI, "replay", workFixture, "--dry-run"],
				{
					encoding: "utf-8",
					timeout: 30_000,
					cwd: REPO_ROOT,
					env: { ...process.env, NO_COLOR: "1" },
				},
			);
			expect(result.status).not.toBe(0);
			expect(result.stderr).toContain("Ledger verification failed");
			expect(result.stderr).toContain("line 2");
		},
		{ timeout: 35_000 },
	);
});
