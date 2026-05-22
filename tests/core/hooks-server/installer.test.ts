import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	installHooksForProvider,
} from "../../../src/core/hooks-server/installer";

let tmp: string;

beforeEach(async () => {
	tmp = await mkdtemp(join(tmpdir(), "apohara-hook-install-test-"));
});
afterEach(async () => {
	await rm(tmp, { recursive: true, force: true });
});

test("installHooksForProvider(claude) writes an executable script", async () => {
	const target = join(tmp, "claude-hook.sh");
	const result = await installHooksForProvider("claude-code-cli", {
		installPath: target,
	});
	expect(result?.status).toBe("installed");
	expect(existsSync(target)).toBe(true);
	const body = await readFile(target, "utf-8");
	expect(body).toContain("#!/usr/bin/env bash");
	expect(body).toContain("HOOK_URL=");
	if (process.platform !== "win32") {
		const st = await stat(target);
		expect(st.mode & 0o111).not.toBe(0); // exec bit
	}
});

test("re-running installer with matching content is a no-op (skipped_existing)", async () => {
	const target = join(tmp, "claude-hook.sh");
	await installHooksForProvider("claude-code-cli", { installPath: target });
	const result = await installHooksForProvider("claude-code-cli", {
		installPath: target,
	});
	expect(result?.status).toBe("skipped_existing");
});

test("differing content backs up the prior file before overwriting", async () => {
	const target = join(tmp, "claude-hook.sh");
	await Bun.write(target, "# stale hook\n");
	const result = await installHooksForProvider("claude-code-cli", {
		installPath: target,
	});
	expect(result?.status).toBe("overwrote_with_backup");
	expect(result?.backupPath).toBeDefined();
	expect(existsSync(result?.backupPath!)).toBe(true);
});

test("installHooksForProvider returns null for unknown provider", async () => {
	const result = await installHooksForProvider("nope-cli");
	expect(result).toBeNull();
});
