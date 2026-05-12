/**
 * Tests for M018 Pattern C — WorktreeManager lifecycle verbs.
 *
 * 12 tests total: 6 verbs × 2 scenarios each (happy path + edge).
 *
 * Filesystem state is isolated per `beforeEach` via `mkdtemp` so the suite
 * is safe to run in parallel and never touches the real `.claude/worktrees/`.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorktreeManager } from "../src/core/worktree-manager";

async function makeFakeWorktree(
	baseDir: string,
	name: string,
	opts: { withMeta?: boolean; taskId?: string; lockMtime?: number } = {},
): Promise<string> {
	const path = join(baseDir, name);
	await mkdir(path, { recursive: true });
	if (opts.withMeta !== false) {
		const meta = {
			taskId: opts.taskId ?? "task-x",
			createdAt: new Date().toISOString(),
			branch: `apohara/${name}`,
		};
		await writeFile(
			join(path, ".apohara-meta.json"),
			JSON.stringify(meta),
			"utf-8",
		);
	}
	const lockPath = join(path, ".apohara-lock");
	await writeFile(lockPath, "1", "utf-8");
	if (opts.lockMtime !== undefined) {
		const sec = opts.lockMtime / 1000;
		await utimes(lockPath, sec, sec);
	}
	return path;
}

describe("WorktreeManager — lifecycle verbs", () => {
	let baseDir: string;
	let mgr: WorktreeManager;

	beforeEach(async () => {
		baseDir = await mkdtemp(join(tmpdir(), "apohara-wt-"));
		mgr = new WorktreeManager(5, baseDir);
	});

	afterEach(async () => {
		await rm(baseDir, { recursive: true, force: true });
	});

	// -----------------------------------------------------------------
	// create
	// -----------------------------------------------------------------

	describe("create", () => {
		it("creates a worktree directory under baseDir with meta + lock", async () => {
			const path = await mgr.create("task-1");
			expect(path.startsWith(baseDir)).toBe(true);
			expect(existsSync(path)).toBe(true);
			expect(existsSync(join(path, ".apohara-meta.json"))).toBe(true);
			expect(existsSync(join(path, ".apohara-lock"))).toBe(true);
		});

		it("produces directory names matching <adj>-<noun>-<6hex>", async () => {
			const path = await mgr.create("task-2");
			const name = path.split("/").pop() ?? "";
			expect(name).toMatch(/^[a-z]+-[a-z]+-[0-9a-f]{6}$/);
		});
	});

	// -----------------------------------------------------------------
	// adoptOrphan
	// -----------------------------------------------------------------

	describe("adoptOrphan", () => {
		it("adopts a worktree whose lock file is older than 5 minutes", async () => {
			const path = await makeFakeWorktree(baseDir, "hopeful-euler-aaaaaa", {
				lockMtime: Date.now() - 10 * 60 * 1000,
			});
			const adopted = await mgr.adoptOrphan(path);
			expect(adopted).toBe(true);
		});

		it("skips a worktree whose lock file is fresh (< 5min)", async () => {
			const path = await makeFakeWorktree(baseDir, "brave-newton-bbbbbb", {
				lockMtime: Date.now() - 30 * 1000,
			});
			const adopted = await mgr.adoptOrphan(path);
			expect(adopted).toBe(false);
		});
	});

	// -----------------------------------------------------------------
	// restoreToProjectRoot
	// -----------------------------------------------------------------

	describe("restoreToProjectRoot", () => {
		it("removes the lock file for a tracked task", async () => {
			const path = await mgr.create("task-restore");
			expect(existsSync(join(path, ".apohara-lock"))).toBe(true);
			await mgr.restoreToProjectRoot("task-restore");
			expect(existsSync(join(path, ".apohara-lock"))).toBe(false);
		});

		it("is a no-op when the task has no worktree", async () => {
			await expect(mgr.restoreToProjectRoot("missing")).resolves.toBeUndefined();
		});
	});

	// -----------------------------------------------------------------
	// cleanup
	// -----------------------------------------------------------------

	describe("cleanup", () => {
		it("removes the worktree directory for a task", async () => {
			const path = await mgr.create("task-cleanup");
			expect(existsSync(path)).toBe(true);
			await mgr.cleanup("task-cleanup");
			expect(existsSync(path)).toBe(false);
		});

		it("is a no-op when the task is unknown", async () => {
			await expect(mgr.cleanup("nope")).resolves.toBeUndefined();
		});
	});

	// -----------------------------------------------------------------
	// list
	// -----------------------------------------------------------------

	describe("list", () => {
		it("returns an empty array when baseDir is empty", async () => {
			const entries = await mgr.list();
			expect(entries).toEqual([]);
		});

		it("returns entries for each managed worktree, ignoring non-matching dirs", async () => {
			await mgr.create("task-a");
			await mgr.create("task-b");
			// Adversarial: a directory that does not match the naming pattern.
			await mkdir(join(baseDir, "user-named-dir"), { recursive: true });

			const entries = await mgr.list();
			expect(entries.length).toBe(2);
			const taskIds = entries.map((e) => e.taskId).sort();
			expect(taskIds).toEqual(["task-a", "task-b"]);
			for (const e of entries) {
				expect(e.path.startsWith(baseDir)).toBe(true);
				expect(e.branch.startsWith("apohara/")).toBe(true);
				expect(typeof e.createdAt).toBe("string");
			}
		});
	});

	// -----------------------------------------------------------------
	// pruneStale
	// -----------------------------------------------------------------

	describe("pruneStale", () => {
		it("prunes worktrees whose dir mtime is older than threshold", async () => {
			const oldPath = await makeFakeWorktree(baseDir, "calm-gauss-cccccc", {
				lockMtime: Date.now() - 24 * 60 * 60 * 1000,
			});
			const veryOld = (Date.now() - 48 * 60 * 60 * 1000) / 1000;
			await utimes(oldPath, veryOld, veryOld);

			const pruned = await mgr.pruneStale(60 * 60 * 1000); // > 1h triggers
			expect(pruned).toBe(1);
			expect(existsSync(oldPath)).toBe(false);
		});

		it("skips worktrees with a fresh lock file (< 1min grace)", async () => {
			const path = await makeFakeWorktree(baseDir, "eager-hopper-dddddd", {
				lockMtime: Date.now(),
			});
			const veryOld = (Date.now() - 48 * 60 * 60 * 1000) / 1000;
			await utimes(path, veryOld, veryOld);

			const pruned = await mgr.pruneStale(60 * 60 * 1000);
			expect(pruned).toBe(0);
			expect(existsSync(path)).toBe(true);
		});
	});
});
