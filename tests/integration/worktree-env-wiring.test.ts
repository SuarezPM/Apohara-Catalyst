/**
 * G7.5.A.8 — Wire composeWorktreeEnv into the spawn path.
 *
 * Before this task, `composeWorktreeEnv` shipped from G5.C.4 (per-worktree
 * env isolation) with full unit coverage in `env-isolation.test.ts` but
 * had ZERO production consumers — the spawn path in
 * `src/providers/cli-driver.ts::runOnce` called `sanitizeEnv(process.env)`
 * and never touched the worktree's `.env`. Every worktree that landed a
 * `.env` to express APOHARA_LOG_LEVEL / feature flags / dispatcher tuning
 * was silently ignored.
 *
 * What this test pins down:
 *   1. The worktree's `.env` IS read at spawn time — benign vars like
 *      `MY_PROJECT_FLAG` show up in the child subprocess env.
 *   2. Sanitization runs BEFORE the worktree overlay — a malicious `.env`
 *      with `ANTHROPIC_API_KEY=stolen` is dropped. `composeWorktreeEnv`'s
 *      own credential blocklist (DEFAULT_BLOCKLIST from §0.4 envSanitizer)
 *      strips it on the way in, and the base env is already sanitized.
 *   3. Forced Apohara markers win over the `.env` — even if the worktree
 *      file lies (`APOHARA_WORKTREE_PATH=/etc`, `APOHARA_DRIVEN=0`), the
 *      orchestrator-set values override.
 *
 * Strategy:
 *   - Fake binary that dumps `process.env` as JSON to stdout (one env=value
 *     line per env entry, JSON-encoded for safe whitespace handling). The
 *     test parses stdout, asserts on the env shape.
 */

import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
	type CliDriverConfig,
	callCliDriver,
} from "../../src/providers/cli-driver";

const ENV_DUMP_BINARY = `#!/usr/bin/env bash
# Dump the inherited env as a JSON object. We use python3 (always present
# on the test runner) because pure bash + jq isn't guaranteed. Each entry
# is a key/value pair from the live env at process start.
python3 -c '
import json, os
print(json.dumps(dict(os.environ)))
'
`;

let workspaceDir: string;
let binaryPath: string;

beforeEach(async () => {
	workspaceDir = await mkdtemp(join(tmpdir(), "apohara-wt-env-wiring-"));
	binaryPath = join(workspaceDir, "fake-env-dump");
	await writeFile(binaryPath, ENV_DUMP_BINARY, "utf-8");
	await chmod(binaryPath, 0o755);
});

afterEach(async () => {
	await rm(workspaceDir, { recursive: true, force: true });
});

function makeCfg(): CliDriverConfig {
	return {
		id: "claude-code-cli",
		label: "fake-env-dump",
		binary: binaryPath,
		// The prompt is irrelevant; the binary ignores argv and dumps env.
		args: () => [],
		defaultModel: "fake",
		// Stdout is a single JSON line — no ANSI to strip.
		cleanOutput: (raw) => raw.trim(),
	};
}

test("spawn loads the worktree's .env (benign vars flow into the child env)", async () => {
	await writeFile(
		join(workspaceDir, ".env"),
		"MY_PROJECT_FLAG=ok\nAPOHARA_LOG_LEVEL=trace\n",
	);

	const res = await callCliDriver(
		makeCfg(),
		[{ role: "user", content: "noop" }],
		workspaceDir,
	);
	const childEnv = JSON.parse(res.content) as Record<string, string>;

	// Benign worktree-local var is present.
	expect(childEnv.MY_PROJECT_FLAG).toBe("ok");
	// APOHARA_* override from the .env is also present.
	expect(childEnv.APOHARA_LOG_LEVEL).toBe("trace");
});

test("sanitize-then-overlay: worktree .env CANNOT smuggle credentials", async () => {
	// The worktree .env lies — claims to set ANTHROPIC_API_KEY. The
	// `composeWorktreeEnv` reader filters via DEFAULT_BLOCKLIST (§0.4
	// envSanitizer), so the credential is stripped on the way in.
	await writeFile(
		join(workspaceDir, ".env"),
		"ANTHROPIC_API_KEY=stolen-from-worktree\nGITHUB_TOKEN=also-stolen\nMY_FLAG=ok\n",
	);

	const res = await callCliDriver(
		makeCfg(),
		[{ role: "user", content: "noop" }],
		workspaceDir,
	);
	const childEnv = JSON.parse(res.content) as Record<string, string>;

	// Credentials NEVER reach the child, even when the .env tries.
	expect(childEnv.ANTHROPIC_API_KEY).toBeUndefined();
	expect(childEnv.GITHUB_TOKEN).toBeUndefined();
	// But the benign var still passes through.
	expect(childEnv.MY_FLAG).toBe("ok");
});

test("Apohara forced markers override any .env attempt to spoof them", async () => {
	// A malicious or stale worktree .env tries to spoof the identity
	// markers and the APOHARA_DRIVEN flag. The spawn must overwrite.
	await writeFile(
		join(workspaceDir, ".env"),
		`APOHARA_WORKTREE_ID=spoofed\nAPOHARA_WORKTREE_PATH=/etc\nAPOHARA_DRIVEN=0\n`,
	);

	const res = await callCliDriver(
		makeCfg(),
		[{ role: "user", content: "noop" }],
		workspaceDir,
	);
	const childEnv = JSON.parse(res.content) as Record<string, string>;

	// APOHARA_DRIVEN is forced to "1" by runOnce regardless of .env.
	expect(childEnv.APOHARA_DRIVEN).toBe("1");
	// Identity markers reflect the real workspace, not the spoof.
	expect(childEnv.APOHARA_WORKTREE_PATH).toBe(workspaceDir);
	expect(childEnv.APOHARA_WORKTREE_ID).toBe(basename(workspaceDir));
	// And the runner-policy plan is still spliced in (defense-in-depth
	// regression guard — must not be erased by the overlay).
	expect(childEnv.APOHARA_RUNNER_POLICY).toBeDefined();
});
