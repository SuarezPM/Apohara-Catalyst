/**
 * Per-worktree named locks (G5.I.7 — vibe-kanban inspiration).
 *
 * Apohara's multi-agent dispatcher can race on per-worktree state:
 *
 *   - Two agents in the SAME process trying to claim the same worktree id.
 *   - A subagent writing a `.apohara-meta.json` while the parent reads it
 *     in `WorktreeManager.list()`.
 *
 * `WorktreeManager` already covers the directory layout + lock-file
 * staleness via `.apohara-lock`. What it does NOT do is provide a
 * per-id mutex callers can hold across an async section.
 *
 * This module fills that gap with:
 *   - A per-id in-process FIFO mutex (covers multi-agent inside the same
 *     bun process, which is the common case).
 *   - An on-disk exclusive lock file (covers cross-process races: two
 *     `apohara` CLI invocations in different terminals).
 *
 * Implementation uses `fs.open(path, "wx")` for the on-disk lock because
 * `O_EXCL` is atomic on POSIX (and on Windows via libuv's emulation). We
 * intentionally avoid adding the `proper-lockfile` dep — the stale-detection
 * algorithm here is intentionally simple and matches the rest of
 * `WorktreeManager` (mtime-based, 5 min staleness).
 */
import { mkdir, open, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface AcquireLockOptions {
	/** Path to a base directory where the lock file lives. */
	lockDir: string;
	/** Worktree id (used as the lock filename). Must be a simple slug. */
	worktreeId: string;
	/** How long to wait for the lock before giving up. Default 5 s. */
	timeoutMs?: number;
	/** Poll interval between in-process retries. Default 25 ms. */
	pollMs?: number;
	/** Lock-file age past which we treat it as orphaned. Default 5 min. */
	staleMs?: number;
}

export interface NamedLock {
	/** Release both the in-process mutex AND the on-disk lock file. */
	release(): Promise<void>;
}

/**
 * Simple FIFO mutex per key — resolves in order of acquisition. Each waiter
 * gets a `wait` promise that resolves when its turn arrives plus a `resolve`
 * function to release the slot, AND an `abort` that yanks itself out of the
 * queue so timeouts don't leave us stuck behind dead waiters.
 */
const inProcessLocks = new Map<string, Promise<unknown>>();

function inProcessAcquire(key: string): {
	wait: Promise<unknown>;
	resolve: () => void;
	abort: () => void;
} {
	let resolveFn = () => {};
	const next = new Promise<void>((res) => {
		resolveFn = res;
	});
	const prev = inProcessLocks.get(key) ?? Promise.resolve();
	const waitFor = prev.then(() => undefined).catch(() => undefined);
	const chained = waitFor.then(() => next);
	inProcessLocks.set(key, chained);
	const abort = () => {
		// If we're still the tail, fast-forward our slot so the next caller
		// doesn't block on us. We resolve immediately and let the chain pass.
		if (inProcessLocks.get(key) === chained) {
			inProcessLocks.delete(key);
		}
		resolveFn();
	};
	return { wait: waitFor, resolve: resolveFn, abort };
}

const WORKTREE_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

/**
 * Acquire an exclusive lock for `worktreeId` rooted at `lockDir`.
 *
 * Throws if the lock cannot be obtained within `timeoutMs`. The caller is
 * responsible for calling `release()` on the returned handle; failure to do
 * so leaves the lock file behind, which subsequent callers will treat as
 * stale after `staleMs` (default 5 min).
 */
export async function acquireLock(
	opts: AcquireLockOptions,
): Promise<NamedLock> {
	if (!WORKTREE_ID_PATTERN.test(opts.worktreeId)) {
		throw new Error(
			`acquireLock: invalid worktreeId "${opts.worktreeId}" — must match ${WORKTREE_ID_PATTERN}`,
		);
	}
	const timeoutMs = opts.timeoutMs ?? 5000;
	const pollMs = opts.pollMs ?? 25;
	const staleMs = opts.staleMs ?? 5 * 60 * 1000;
	const lockPath = join(opts.lockDir, `${opts.worktreeId}.lock`);
	const inProcessKey = lockPath;

	const {
		wait,
		resolve: releaseInProcess,
		abort: abortInProcess,
	} = inProcessAcquire(inProcessKey);

	const deadline = Date.now() + timeoutMs;
	// Race the queue wait against the timeout.
	const waitTimeout = new Promise<"timeout">((res) =>
		setTimeout(() => res("timeout"), Math.max(0, deadline - Date.now())),
	);
	const winner = await Promise.race([wait.then(() => "ok" as const), waitTimeout]);
	if (winner === "timeout") {
		abortInProcess();
		throw new Error(
			`acquireLock: timed out after ${timeoutMs}ms waiting for in-process slot on ${lockPath}`,
		);
	}

	let opened = false;
	while (!opened) {
		try {
			await mkdir(dirname(lockPath), { recursive: true });
			const handle = await open(lockPath, "wx");
			await handle.writeFile(
				JSON.stringify({
					pid: process.pid,
					acquiredAt: new Date().toISOString(),
				}),
			);
			await handle.close();
			opened = true;
			break;
		} catch (err) {
			const code = (err as NodeJS.ErrnoException).code;
			if (code !== "EEXIST") {
				releaseInProcess();
				throw err;
			}
			// Existing lock: check staleness.
			try {
				const s = await stat(lockPath);
				const age = Date.now() - s.mtimeMs;
				if (age > staleMs) {
					await rm(lockPath, { force: true });
					continue; // retry immediately
				}
			} catch {
				// Lock vanished between stat and retry — try again.
				continue;
			}
			if (Date.now() > deadline) {
				releaseInProcess();
				throw new Error(
					`acquireLock: timed out after ${timeoutMs}ms waiting for ${lockPath}`,
				);
			}
			await new Promise((r) => setTimeout(r, pollMs));
		}
	}

	let released = false;
	return {
		async release(): Promise<void> {
			if (released) return;
			released = true;
			try {
				await rm(lockPath, { force: true });
			} finally {
				releaseInProcess();
			}
		},
	};
}

/**
 * Convenience helper: acquire, run `fn`, always release.
 */
export async function withLock<T>(
	opts: AcquireLockOptions,
	fn: () => Promise<T>,
): Promise<T> {
	const lock = await acquireLock(opts);
	try {
		return await fn();
	} finally {
		await lock.release();
	}
}
