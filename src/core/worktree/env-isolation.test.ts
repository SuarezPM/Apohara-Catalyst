/**
 * G5.C.4 — Per-worktree env isolation (claude-octopus #10).
 *
 * Each worktree owns a `.env` file inside its workspace. When spawning
 * a subagent for that worktree, we merge:
 *   1. Base sanitized env (no API keys — §0.4)
 *   2. Worktree-local APOHARA_* overrides from <worktree>/.env
 *   3. Explicit APOHARA_WORKTREE_ID + APOHARA_WORKTREE_PATH markers
 *
 * The .env reader rejects any key matching the credential blocklist
 * (§0.4) so a malicious worktree file can't inject ANTHROPIC_API_KEY.
 */
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	loadWorktreeEnv,
	composeWorktreeEnv,
} from "./env-isolation.js";

describe("loadWorktreeEnv", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "apohara-worktree-env-"));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("returns empty when no .env file exists", async () => {
		const env = await loadWorktreeEnv(dir);
		expect(env).toEqual({});
	});

	it("parses KEY=VALUE lines", async () => {
		await writeFile(
			join(dir, ".env"),
			"APOHARA_WORKER_ID=w1\nAPOHARA_LOG_LEVEL=debug\n",
		);
		const env = await loadWorktreeEnv(dir);
		expect(env).toEqual({
			APOHARA_WORKER_ID: "w1",
			APOHARA_LOG_LEVEL: "debug",
		});
	});

	it("strips surrounding quotes", async () => {
		await writeFile(
			join(dir, ".env"),
			`APOHARA_QUOTED="hello world"\nAPOHARA_SINGLE='one'\n`,
		);
		const env = await loadWorktreeEnv(dir);
		expect(env.APOHARA_QUOTED).toBe("hello world");
		expect(env.APOHARA_SINGLE).toBe("one");
	});

	it("ignores comments and blank lines", async () => {
		await writeFile(
			join(dir, ".env"),
			"# a comment\n\nAPOHARA_X=1\n  \nAPOHARA_Y=2\n",
		);
		const env = await loadWorktreeEnv(dir);
		expect(env).toEqual({ APOHARA_X: "1", APOHARA_Y: "2" });
	});

	it("rejects blocklisted keys (credentials must NOT come from worktree .env)", async () => {
		await writeFile(
			join(dir, ".env"),
			"APOHARA_OK=1\nANTHROPIC_API_KEY=stolen\nGITHUB_TOKEN=x\nAWS_SECRET_ACCESS_KEY=y\n",
		);
		const env = await loadWorktreeEnv(dir);
		expect(env.APOHARA_OK).toBe("1");
		expect(env.ANTHROPIC_API_KEY).toBeUndefined();
		expect(env.GITHUB_TOKEN).toBeUndefined();
		expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
	});

	it("rejects keys outside the APOHARA_ allowlist when strict=true", async () => {
		await writeFile(
			join(dir, ".env"),
			"APOHARA_OK=1\nPATH=/evil\nHOME=/tmp\n",
		);
		const env = await loadWorktreeEnv(dir, { strict: true });
		expect(env).toEqual({ APOHARA_OK: "1" });
	});

	it("allows safe-list non-APOHARA keys when strict=false (default)", async () => {
		await writeFile(
			join(dir, ".env"),
			"APOHARA_OK=1\nPATH=/safe\n",
		);
		const env = await loadWorktreeEnv(dir);
		// PATH is in the global safe-list but NOT in the credential blocklist.
		// In non-strict mode we surface it.
		expect(env.PATH).toBe("/safe");
	});

	it("handles inline export prefix", async () => {
		await writeFile(
			join(dir, ".env"),
			"export APOHARA_X=42\n",
		);
		const env = await loadWorktreeEnv(dir);
		expect(env.APOHARA_X).toBe("42");
	});
});

describe("composeWorktreeEnv", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "apohara-worktree-compose-"));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("combines base env + worktree .env + markers", async () => {
		await writeFile(
			join(dir, ".env"),
			"APOHARA_LOG_LEVEL=trace\n",
		);
		const env = await composeWorktreeEnv({
			baseEnv: { PATH: "/usr/bin", HOME: "/home/user" },
			worktreePath: dir,
			worktreeId: "wt-1",
		});
		expect(env.PATH).toBe("/usr/bin");
		expect(env.HOME).toBe("/home/user");
		expect(env.APOHARA_LOG_LEVEL).toBe("trace");
		expect(env.APOHARA_WORKTREE_ID).toBe("wt-1");
		expect(env.APOHARA_WORKTREE_PATH).toBe(dir);
	});

	it("worktree .env overrides base env (e.g. log level)", async () => {
		await writeFile(
			join(dir, ".env"),
			"APOHARA_LOG_LEVEL=debug\n",
		);
		const env = await composeWorktreeEnv({
			baseEnv: { APOHARA_LOG_LEVEL: "info" },
			worktreePath: dir,
			worktreeId: "w",
		});
		expect(env.APOHARA_LOG_LEVEL).toBe("debug");
	});

	it("worktree .env cannot inject credentials even if file lies", async () => {
		await writeFile(
			join(dir, ".env"),
			"ANTHROPIC_API_KEY=stolen-from-worktree\n",
		);
		const env = await composeWorktreeEnv({
			baseEnv: {},
			worktreePath: dir,
			worktreeId: "w",
		});
		expect(env.ANTHROPIC_API_KEY).toBeUndefined();
	});

	it("APOHARA_WORKTREE_* markers are never overrideable from .env", async () => {
		await writeFile(
			join(dir, ".env"),
			"APOHARA_WORKTREE_ID=spoofed\nAPOHARA_WORKTREE_PATH=/etc\n",
		);
		const env = await composeWorktreeEnv({
			baseEnv: {},
			worktreePath: dir,
			worktreeId: "real",
		});
		expect(env.APOHARA_WORKTREE_ID).toBe("real");
		expect(env.APOHARA_WORKTREE_PATH).toBe(dir);
	});

	it("missing .env file returns just base + markers", async () => {
		const env = await composeWorktreeEnv({
			baseEnv: { PATH: "/bin" },
			worktreePath: dir,
			worktreeId: "x",
		});
		expect(env).toEqual({
			PATH: "/bin",
			APOHARA_WORKTREE_ID: "x",
			APOHARA_WORKTREE_PATH: dir,
		});
	});

	it("supports nested worktree directories", async () => {
		const nested = join(dir, "subdir");
		await mkdir(nested, { recursive: true });
		await writeFile(
			join(nested, ".env"),
			"APOHARA_NESTED=yes\n",
		);
		const env = await composeWorktreeEnv({
			baseEnv: {},
			worktreePath: nested,
			worktreeId: "n",
		});
		expect(env.APOHARA_NESTED).toBe("yes");
	});
});
