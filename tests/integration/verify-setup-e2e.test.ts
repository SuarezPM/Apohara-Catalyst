/**
 * G10.D.2 — e2e test for `apohara verify-setup` with `--skip-real-providers`.
 *
 * CI environments (cross-platform matrix, npx-install-smoke) don't have real
 * Claude/Codex/OpenCode CLIs installed, but we still want to exercise the
 * verify-setup wiring: argv parsing, command registration in `src/cli.ts`,
 * and the early-return guard that skips the real provider round-trip.
 *
 * The flag short-circuits before any spawn happens — the command prints a
 * success banner and exits 0. Without the flag, the command would attempt
 * the LOCAL-SETUP-001 enrollment + provider echo round-trip and fail in CI.
 */
import { expect, test } from "bun:test";
import { execSync } from "node:child_process";

const CLI = "bun run src/cli.ts";

test("verify-setup --skip-real-providers exits 0", () => {
	const out = execSync(`${CLI} verify-setup --skip-real-providers 2>&1`, {
		encoding: "utf-8",
		timeout: 30_000,
	});
	expect(out).toMatch(/verify-setup|skipping real provider|ok/i);
}, 35_000);

test("verify-setup --help advertises the --skip-real-providers flag", () => {
	const out = execSync(`${CLI} verify-setup --help 2>&1`, {
		encoding: "utf-8",
		timeout: 30_000,
	});
	expect(out).toContain("--skip-real-providers");
}, 35_000);
