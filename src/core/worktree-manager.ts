/**
 * WorktreeManager - lifecycle management for `.claude/worktrees/`.
 *
 * Extracted from `subagent-manager.ts` per M018 Pattern C plan. Combines:
 *
 *   - The legacy in-process pool (acquire/release/getAvailableCount) used by
 *     SubagentManager to throttle parallel agent dispatch.
 *
 *   - The new filesystem lifecycle verbs (create, adoptOrphan,
 *     restoreToProjectRoot, cleanup, list, pruneStale) that formalize the
 *     `.claude/worktrees/<adjective>-<noun>-<id>` directory contract used by
 *     real subagent worktrees on disk.
 *
 * The two surfaces share state via the same `WorktreeManager` instance so
 * callers can move incrementally from the in-process pool model to real
 * worktree provisioning without changing the class.
 */

import { randomBytes } from "node:crypto";
import {
	access,
	mkdir,
	readdir,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";

/**
 * Filesystem-visible record for a worktree directory.
 *
 * Returned by `list()` and consumed by Pattern F (`apohara state --json`).
 */
export interface WorktreeEntry {
	taskId: string;
	path: string;
	createdAt: string;
	branch: string;
}

/**
 * Naming pattern enforced for adopt / prune operations.
 *
 * Matches `<adjective>-<noun>-<6 hex chars>` to guard against accidentally
 * touching user-named worktrees that happen to live in the same directory.
 */
const WORKTREE_NAME_PATTERN = /^[a-z]+-[a-z]+-[0-9a-f]{6}$/;

/**
 * Lock file age threshold before adopt is allowed.
 *
 * If the lock file is fresher than this, another process is presumed to be
 * using the worktree and adoption is skipped.
 */
const ADOPT_LOCK_AGE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Lock file age threshold for `pruneStale`.
 *
 * Worktrees with locks fresher than this are skipped even if their mtime is
 * stale, to avoid yanking a worktree out from under an active subagent.
 */
const PRUNE_LOCK_GRACE_MS = 60 * 1000; // 1 minute

/**
 * Sentinel files written inside each managed worktree.
 */
const LOCK_FILE = ".apohara-lock";
const META_FILE = ".apohara-meta.json";

interface WorktreeMeta {
	taskId: string;
	createdAt: string;
	branch: string;
}

function randomSlug(): string {
	const adjectives = [
		"hopeful",
		"brave",
		"calm",
		"eager",
		"gentle",
		"jolly",
		"keen",
		"lucid",
		"merry",
		"nimble",
	];
	const nouns = [
		"bhaskara",
		"euler",
		"gauss",
		"hopper",
		"lovelace",
		"newton",
		"pascal",
		"ramanujan",
		"tesla",
		"turing",
	];
	const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
	const noun = nouns[Math.floor(Math.random() * nouns.length)];
	const id = randomBytes(3).toString("hex");
	return `${adj}-${noun}-${id}`;
}

export class WorktreeManager {
	// In-process pool kept for backwards compatibility with the original
	// subagent-manager inner class. Tracks logical "lanes" rather than real
	// worktree paths.
	private pool: Map<string, boolean> = new Map();

	// Base directory for real worktrees on disk. Override in tests via
	// constructor.
	private baseDir: string;

	constructor(maxWorktrees: number = 5, baseDir?: string) {
		for (let i = 0; i < maxWorktrees; i++) {
			this.pool.set(`worktree-${i}`, true);
		}
		this.baseDir = baseDir ?? join(process.cwd(), ".claude", "worktrees");
	}

	// ---------------------------------------------------------------------------
	// Legacy in-process pool API — preserved verbatim for SubagentManager.
	// ---------------------------------------------------------------------------

	async acquire(): Promise<string | null> {
		for (const [id, available] of this.pool) {
			if (available) {
				this.pool.set(id, false);
				return id;
			}
		}
		return null;
	}

	async release(id: string): Promise<void> {
		this.pool.set(id, true);
	}

	getAvailableCount(): number {
		let count = 0;
		for (const available of this.pool.values()) {
			if (available) count++;
		}
		return count;
	}

	// ---------------------------------------------------------------------------
	// New lifecycle verbs (M018 Pattern C).
	// ---------------------------------------------------------------------------

	getBaseDir(): string {
		return this.baseDir;
	}

	/**
	 * Provision a managed worktree directory for `taskId`.
	 *
	 * Creates `<baseDir>/<adjective>-<noun>-<id>/` plus a meta + lock file.
	 * The directory layout intentionally mirrors what crashed sessions leave
	 * behind so `adoptOrphan` and `pruneStale` operate on the same contract.
	 */
	async create(taskId: string): Promise<string> {
		await mkdir(this.baseDir, { recursive: true });
		const slug = randomSlug();
		const path = join(this.baseDir, slug);
		await mkdir(path, { recursive: true });

		const meta: WorktreeMeta = {
			taskId,
			createdAt: new Date().toISOString(),
			branch: `apohara/${slug}`,
		};
		await writeFile(join(path, META_FILE), JSON.stringify(meta), "utf-8");
		await writeFile(join(path, LOCK_FILE), String(process.pid), "utf-8");
		return path;
	}

	/**
	 * Attempt to adopt an orphaned worktree directory.
	 *
	 * - The path must live under `baseDir` and match the naming pattern.
	 * - If the lock file is older than ADOPT_LOCK_AGE_MS the directory is
	 *   safely adoptable; we refresh the lock and return true.
	 * - If the lock is fresh, return false (skip — someone is using it).
	 * - If there is no meta file at all, prune the directory and return false.
	 */
	async adoptOrphan(path: string): Promise<boolean> {
		const name = path.split("/").pop() ?? "";
		if (!WORKTREE_NAME_PATTERN.test(name)) {
			return false;
		}

		try {
			await access(path);
		} catch {
			return false;
		}

		const metaPath = join(path, META_FILE);
		try {
			await access(metaPath);
		} catch {
			await rm(path, { recursive: true, force: true });
			return false;
		}

		const lockPath = join(path, LOCK_FILE);
		let lockAgeMs = Number.POSITIVE_INFINITY;
		try {
			const lockStat = await stat(lockPath);
			lockAgeMs = Date.now() - lockStat.mtimeMs;
		} catch {
			// Missing lock file: treat as stale and adoptable.
		}

		if (lockAgeMs < ADOPT_LOCK_AGE_MS) {
			return false;
		}

		await writeFile(lockPath, String(process.pid), "utf-8");
		return true;
	}

	/**
	 * Restore a worktree's tracked branch back to the project root.
	 *
	 * In the in-process pool model this is a no-op; for the on-disk model we
	 * remove the lock file so the worktree is marked "available". The verb
	 * exists so callers have a symmetric counterpart to `create`.
	 */
	async restoreToProjectRoot(taskId: string): Promise<void> {
		const entries = await this.list();
		const entry = entries.find((e) => e.taskId === taskId);
		if (!entry) return;
		await rm(join(entry.path, LOCK_FILE), { force: true });
	}

	/**
	 * Remove the worktree directory associated with a task.
	 */
	async cleanup(taskId: string): Promise<void> {
		const entries = await this.list();
		const entry = entries.find((e) => e.taskId === taskId);
		if (!entry) return;
		await rm(entry.path, { recursive: true, force: true });
	}

	/**
	 * List every managed worktree currently under `baseDir`.
	 */
	async list(): Promise<WorktreeEntry[]> {
		let names: string[];
		try {
			names = await readdir(this.baseDir);
		} catch {
			return [];
		}

		const entries: WorktreeEntry[] = [];
		for (const name of names) {
			if (!WORKTREE_NAME_PATTERN.test(name)) continue;
			const path = join(this.baseDir, name);
			const metaPath = join(path, META_FILE);
			try {
				const raw = await Bun.file(metaPath).text();
				const meta = JSON.parse(raw) as WorktreeMeta;
				entries.push({
					taskId: meta.taskId,
					path,
					createdAt: meta.createdAt,
					branch: meta.branch,
				});
			} catch {
				// No meta — skip. pruneStale handles this.
			}
		}
		return entries;
	}

	/**
	 * Garbage-collect worktrees that look abandoned.
	 *
	 * A worktree is a prune candidate if its directory mtime is older than
	 * `olderThanMs`. Active worktrees (lock file fresher than
	 * PRUNE_LOCK_GRACE_MS) are skipped to avoid evicting a running subagent.
	 */
	async pruneStale(olderThanMs: number): Promise<number> {
		let names: string[];
		try {
			names = await readdir(this.baseDir);
		} catch {
			return 0;
		}

		const now = Date.now();
		let pruned = 0;

		for (const name of names) {
			if (!WORKTREE_NAME_PATTERN.test(name)) continue;
			const path = join(this.baseDir, name);

			let dirAgeMs = 0;
			try {
				const dirStat = await stat(path);
				dirAgeMs = now - dirStat.mtimeMs;
			} catch {
				continue;
			}
			if (dirAgeMs < olderThanMs) continue;

			let lockAgeMs = Number.POSITIVE_INFINITY;
			try {
				const lockStat = await stat(join(path, LOCK_FILE));
				lockAgeMs = now - lockStat.mtimeMs;
			} catch {
				// no lock — treat as stale
			}
			if (lockAgeMs < PRUNE_LOCK_GRACE_MS) continue;

			await rm(path, { recursive: true, force: true });
			pruned += 1;
		}

		return pruned;
	}
}

export default WorktreeManager;
