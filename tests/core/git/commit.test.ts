import { afterEach, beforeEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { proposeCommit } from "../../../src/core/git/commit";

let workspace: string;

function git(args: string[], cwd: string): string {
	const r = spawnSync("git", args, { cwd, encoding: "utf-8" });
	if (r.status !== 0) {
		throw new Error(
			`git ${args.join(" ")} failed (${r.status}): ${r.stderr}`,
		);
	}
	return r.stdout;
}

beforeEach(async () => {
	workspace = await mkdtemp(join(tmpdir(), "apohara-commit-test-"));
	git(["init", "--initial-branch=main"], workspace);
	git(["config", "user.email", "test@apohara"], workspace);
	git(["config", "user.name", "Apohara Test"], workspace);
	await writeFile(join(workspace, "seed.txt"), "initial\n");
	git(["add", "seed.txt"], workspace);
	git(["commit", "-m", "seed"], workspace);
});
afterEach(async () => {
	await rm(workspace, { recursive: true, force: true });
});

test("proposeCommit (autoCommit=false) returns pending without touching git", async () => {
	await writeFile(join(workspace, "a.txt"), "hello\n");
	const r = await proposeCommit({
		workspace,
		filesToStage: ["a.txt"],
		message: "add a.txt",
	});
	expect(r.committed).toBe(false);
	expect(r.pending).toBe(true);
	// Nothing should be staged.
	const status = git(["status", "--porcelain"], workspace);
	expect(status).toContain("?? a.txt");
});

test("proposeCommit (autoCommit=true) stages + commits + returns SHA", async () => {
	await writeFile(join(workspace, "b.txt"), "hi\n");
	const r = await proposeCommit({
		workspace,
		filesToStage: ["b.txt"],
		message: "add b.txt",
		authorName: "Apohara Test",
		authorEmail: "test@apohara",
		autoCommit: true,
	});
	expect(r.committed).toBe(true);
	expect(r.sha).toMatch(/^[a-f0-9]{40}$/);
	const log = git(["log", "--oneline"], workspace);
	expect(log).toContain("add b.txt");
});

test("proposeCommit rejects empty filesToStage", async () => {
	const r = await proposeCommit({
		workspace,
		filesToStage: [],
		message: "x",
	});
	expect(r.committed).toBe(false);
	expect(r.error).toContain("non-empty");
});

test("proposeCommit rejects empty commitMessage", async () => {
	const r = await proposeCommit({
		workspace,
		filesToStage: ["seed.txt"],
		message: "",
	});
	expect(r.committed).toBe(false);
	expect(r.error).toContain("message is required");
});

test("proposeCommit rejects non-git workspace", async () => {
	const notGit = await mkdtemp(join(tmpdir(), "apohara-not-git-"));
	try {
		const r = await proposeCommit({
			workspace: notGit,
			filesToStage: ["x.txt"],
			message: "x",
			autoCommit: true,
		});
		expect(r.committed).toBe(false);
		expect(r.error).toContain("not a git repo");
	} finally {
		await rm(notGit, { recursive: true, force: true });
	}
});
