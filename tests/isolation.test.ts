import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "bun";
import { IsolationEngine } from "../src/core/isolation";

describe("IsolationEngine Integration", () => {
	const TEMP_REPO = join(process.cwd(), "tests/tmp-repo");
	const WORKTREE_PATH = join(process.cwd(), "tests/tmp-worktree");

	beforeAll(async () => {
		await rm(TEMP_REPO, { recursive: true, force: true });
		await rm(WORKTREE_PATH, { recursive: true, force: true });

		await mkdir(TEMP_REPO, { recursive: true });
		const init = spawn(["git", "init"], { cwd: TEMP_REPO });
		await init.exited;

		const commitEnv = {
			...process.env,
			GIT_AUTHOR_NAME: "Test",
			GIT_AUTHOR_EMAIL: "test@test.com",
			GIT_COMMITTER_NAME: "Test",
			GIT_COMMITTER_EMAIL: "test@test.com",
		};
		const commit = spawn(
			["git", "commit", "--allow-empty", "-m", "Initial commit"],
			{ cwd: TEMP_REPO, env: commitEnv },
		);
		await commit.exited;
	});

	afterAll(async () => {
		await rm(TEMP_REPO, { recursive: true, force: true });
		await rm(WORKTREE_PATH, { recursive: true, force: true });
	});

	it("should create and destroy a git worktree", async () => {
		// Need to use absolute path for the binary since we are changing cwd for the spawn
		const engine = new IsolationEngine(
			resolve("isolation-engine/target/debug/isolation-engine"),
		);

		// Create worktree
		const createResult = await engine.createWorktree(
			WORKTREE_PATH,
			"test-branch",
			TEMP_REPO,
		);
		expect(createResult.status).toBe("success");
		expect(createResult.message).toContain("Worktree created");

		// Verify the directory exists
		const dirStat = await stat(WORKTREE_PATH);
		expect(dirStat.isDirectory()).toBe(true);

		// Verify it's a valid worktree
		const status = spawn(["git", "status"], { cwd: WORKTREE_PATH });
		const exitCode = await status.exited;
		expect(exitCode).toBe(0);

		// Destroy worktree
		const destroyResult = await engine.destroyWorktree(
			WORKTREE_PATH,
			TEMP_REPO,
		);
		expect(destroyResult.status).toBe("success");
		expect(destroyResult.message).toContain("destroyed");

		// Verify directory is gone
		let exists = true;
		try {
			await stat(WORKTREE_PATH);
		} catch {
			exists = false;
		}
		expect(exists).toBe(false);
	});
});
