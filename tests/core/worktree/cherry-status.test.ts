/**
 * Tests for worktree status via `git cherry` (G5.I.6).
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { uniqueCommitsAhead } from "../../../src/core/worktree/cherry-status";

function runGit(cwd: string, args: string[]): Promise<number> {
	return new Promise((resolve) => {
		const child = spawn("git", args, {
			cwd,
			env: {
				...process.env,
				GIT_AUTHOR_NAME: "Test",
				GIT_AUTHOR_EMAIL: "test@example.com",
				GIT_COMMITTER_NAME: "Test",
				GIT_COMMITTER_EMAIL: "test@example.com",
			},
			stdio: ["ignore", "ignore", "ignore"],
		});
		child.on("close", (code) => resolve(code ?? -1));
	});
}

async function makeRepo(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "apohara-cherry-"));
	expect(await runGit(dir, ["init", "-b", "main"])).toBe(0);
	expect(await runGit(dir, ["config", "user.email", "t@e.com"])).toBe(0);
	expect(await runGit(dir, ["config", "user.name", "T"])).toBe(0);
	expect(await runGit(dir, ["config", "commit.gpgsign", "false"])).toBe(0);
	return dir;
}

async function commitFile(
	dir: string,
	name: string,
	content: string,
	msg: string,
): Promise<void> {
	await writeFile(join(dir, name), content);
	expect(await runGit(dir, ["add", "--", name])).toBe(0);
	expect(await runGit(dir, ["commit", "-m", msg])).toBe(0);
}

describe("uniqueCommitsAhead", () => {
	let repo: string;
	beforeEach(async () => {
		repo = await makeRepo();
		await commitFile(repo, "seed.txt", "base", "base commit");
	});
	afterEach(async () => {
		await rm(repo, { recursive: true, force: true });
	});

	test("returns 0 when head == base", async () => {
		const r = await uniqueCommitsAhead({
			workspace: repo,
			base: "main",
			head: "main",
		});
		expect(r.error).toBeUndefined();
		expect(r.count).toBe(0);
	});

	test("counts commits unique to head", async () => {
		expect(await runGit(repo, ["checkout", "-b", "feature"])).toBe(0);
		await commitFile(repo, "a.txt", "1", "feat A");
		await commitFile(repo, "b.txt", "2", "feat B");

		const r = await uniqueCommitsAhead({
			workspace: repo,
			base: "main",
			head: "feature",
		});
		expect(r.error).toBeUndefined();
		expect(r.count).toBe(2);
	});

	test("returns -1 with error when ref is invalid (flag injection)", async () => {
		const r = await uniqueCommitsAhead({
			workspace: repo,
			base: "--upload-pack=evil",
			head: "main",
		});
		expect(r.count).toBe(-1);
		expect(r.error).toMatch(/invalid base ref/);
	});

	test("returns -1 with error when ref contains ..", async () => {
		const r = await uniqueCommitsAhead({
			workspace: repo,
			base: "main..feature",
			head: "main",
		});
		expect(r.count).toBe(-1);
		expect(r.error).toMatch(/invalid base ref/);
	});

	test("returns -1 with error when git fails (unknown ref)", async () => {
		const r = await uniqueCommitsAhead({
			workspace: repo,
			base: "main",
			head: "does-not-exist",
		});
		expect(r.count).toBe(-1);
		expect(r.error).toMatch(/git cherry failed/);
	});

	test("ignores commits already on base (cherry-pick equivalence)", async () => {
		// Branch off, make a commit, cherry-pick to main, then ask cherry to
		// count: feature should now have 0 unique commits relative to main.
		expect(await runGit(repo, ["checkout", "-b", "feature"])).toBe(0);
		await commitFile(repo, "x.txt", "x", "pickme");
		const sha = await new Promise<string>((res) => {
			let out = "";
			const ch = spawn("git", ["rev-parse", "HEAD"], { cwd: repo });
			ch.stdout?.on("data", (c) => (out += c.toString()));
			ch.on("close", () => res(out.trim()));
		});
		expect(await runGit(repo, ["checkout", "main"])).toBe(0);
		expect(await runGit(repo, ["cherry-pick", sha])).toBe(0);

		const r = await uniqueCommitsAhead({
			workspace: repo,
			base: "main",
			head: "feature",
		});
		expect(r.error).toBeUndefined();
		// `git cherry` marks equivalent commits with `-`; should be 0 `+` lines.
		expect(r.count).toBe(0);
	});
});
