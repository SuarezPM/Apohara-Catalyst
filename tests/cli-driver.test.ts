/**
 * Tests for the CLI-driver provider (Gap 2 / multi-AI orchestration).
 *
 * We use a tiny fake-binary script written into a tmp dir so the test
 * never depends on having `claude` / `codex` / `gemini` installed (and
 * the real CLIs need auth, which the test runner doesn't have).
 *
 * The fake binary echoes a canned response while honoring the same
 * argv / stdin / exit-code contract the real ones use, which is
 * exactly what the driver framework needs to verify.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type CliDriverConfig,
	callCliDriver,
} from "../src/providers/cli-driver";

const FAKE_BINARY = `#!/usr/bin/env bash
# A fake agent CLI. Behavior:
#   echo "MARK"
#   printf "you said: "
#   echo "$@"
# Exits 0 unless APOHARA_FAKE_FAIL=1 (then exits 7, writes to stderr).

if [ "\${APOHARA_FAKE_FAIL:-0}" = "1" ]; then
  echo "fake-cli: forced failure" >&2
  exit 7
fi

printf "MARK\\nyou said: "
echo "$@"
`;

const FAKE_BINARY_WITH_STDIN = `#!/usr/bin/env bash
# A fake CLI that reads its prompt from stdin and echoes it back
# with a stable prefix so the test can verify the byte path.

echo "STDIN_MODE"
cat
`;

async function writeFakeBinary(
	dir: string,
	name: string,
	script: string,
): Promise<string> {
	const path = join(dir, name);
	await writeFile(path, script, "utf-8");
	await chmod(path, 0o755);
	return path;
}

describe("callCliDriver", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "apohara-cli-driver-test-"));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("captures stdout, exits 0, returns the cleaned content", async () => {
		const binary = await writeFakeBinary(dir, "fake-claude", FAKE_BINARY);
		const cfg: CliDriverConfig = {
			id: "claude-code-cli",
			label: "fake-claude",
			binary,
			args: ({ prompt }) => [prompt],
			defaultModel: "fake-claude-model",
			cleanOutput: (raw) => raw.trim(),
		};
		const res = await callCliDriver(cfg, [
			{ role: "user", content: "build a CRUD endpoint" },
		]);
		expect(res.provider).toBe("claude-code-cli");
		expect(res.model).toBe("fake-claude-model");
		expect(res.content.startsWith("MARK")).toBe(true);
		expect(res.content).toContain("[user] build a CRUD endpoint");
	});

	it("threads the system prompt through `args` when one is supplied", async () => {
		const binary = await writeFakeBinary(dir, "fake-claude", FAKE_BINARY);
		const seen: string[][] = [];
		const cfg: CliDriverConfig = {
			id: "claude-code-cli",
			label: "fake-claude-system",
			binary,
			args: ({ prompt, system }) => {
				// Mirror the real-claude pattern (--append-system-prompt).
				const argv = system ? ["--system", system, prompt] : [prompt];
				seen.push(argv);
				return argv;
			},
			defaultModel: "fake",
		};
		await callCliDriver(cfg, [
			{ role: "system", content: "you are concise" },
			{ role: "user", content: "hi" },
		]);
		expect(seen.length).toBe(1);
		expect(seen[0]).toContain("--system");
		expect(seen[0]).toContain("you are concise");
	});

	it("pipes the prompt to stdin when cfg.stdin is true", async () => {
		const binary = await writeFakeBinary(
			dir,
			"fake-stdin",
			FAKE_BINARY_WITH_STDIN,
		);
		const cfg: CliDriverConfig = {
			id: "codex-cli",
			label: "fake-stdin",
			binary,
			stdin: true,
			args: () => [],
			defaultModel: "fake",
			cleanOutput: (raw) => raw.trim(),
		};
		const res = await callCliDriver(cfg, [
			{ role: "user", content: "this prompt arrives via stdin" },
		]);
		expect(res.content.startsWith("STDIN_MODE")).toBe(true);
		expect(res.content).toContain("[user] this prompt arrives via stdin");
	});

	it("propagates non-zero exit codes with stderr context", async () => {
		const binary = await writeFakeBinary(dir, "fake-fail", FAKE_BINARY);
		const cfg: CliDriverConfig = {
			id: "gemini-cli",
			label: "fake-fail",
			binary,
			args: ({ prompt }) => [prompt],
			defaultModel: "fake",
		};
		// We flip the env in-place; callCliDriver inherits process.env.
		const prev = process.env.APOHARA_FAKE_FAIL;
		process.env.APOHARA_FAKE_FAIL = "1";
		try {
			await expect(
				callCliDriver(cfg, [{ role: "user", content: "x" }]),
			).rejects.toThrow(/exited with code 7/);
		} finally {
			if (prev === undefined) delete process.env.APOHARA_FAKE_FAIL;
			else process.env.APOHARA_FAKE_FAIL = prev;
		}
	});

	it("surfaces ENOENT cleanly when the binary is missing", async () => {
		const cfg: CliDriverConfig = {
			id: "claude-code-cli",
			label: "missing",
			binary: join(dir, "definitely-not-installed-binary-xyz"),
			args: ({ prompt }) => [prompt],
			defaultModel: "fake",
		};
		await expect(
			callCliDriver(cfg, [{ role: "user", content: "x" }]),
		).rejects.toThrow(/not found on PATH/);
	});

	it("kills + rejects on timeout", async () => {
		const slowBinary = await writeFakeBinary(
			dir,
			"fake-slow",
			`#!/usr/bin/env bash
sleep 5
echo "should never appear"
`,
		);
		const cfg: CliDriverConfig = {
			id: "codex-cli",
			label: "fake-slow",
			binary: slowBinary,
			args: () => [],
			timeoutMs: 200,
			defaultModel: "fake",
		};
		const start = Date.now();
		await expect(
			callCliDriver(cfg, [{ role: "user", content: "x" }]),
		).rejects.toThrow(/timed out after 200/);
		const elapsed = Date.now() - start;
		expect(elapsed).toBeLessThan(2000);
	});
});
