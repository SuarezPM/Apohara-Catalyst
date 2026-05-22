/**
 * Result-file watcher.
 *
 * Watches `<workspace>/.apohara/runs/<sessionId>/results/` for new
 * `<taskId>.json` files. When one lands, parses it and appends the
 * matching ledger event (`task_completed` / `task_failed`) to the
 * session's JSONL ledger. The SSE handler tails that ledger; the UI
 * bus bridge in `App.tsx` re-publishes each event onto the
 * `apohara://*` bus.
 *
 * Implementation note: Linux's `fs.watch` on a directory only delivers
 * the inotify event for the *temporary* filename when the writer does
 * an atomic temp-then-rename (which `atomicWriteFile` always does).
 * The final renamed `<taskId>.json` is never reported as a separate
 * event. So instead of relying on the event filename, we treat every
 * watch tick as a "something changed, rescan" signal and read the
 * directory listing, processing any `*.json` we haven't seen yet.
 *
 * A 1 s polling backup runs alongside fs.watch so flaky inotify
 * (NFS, FUSE, some bun versions) never strands a result.
 */
import { watch as fsWatch } from "node:fs";
import { appendFile, readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import { dispatchPaths, type DispatchResult } from "./types.js";

export interface ResultWatcherOptions {
	workspace: string;
	sessionId: string;
	ledgerPath: string;
}

export interface Disposable {
	close(): void;
}

export function watchSessionResults(opts: ResultWatcherOptions): Disposable {
	const paths = dispatchPaths(opts.workspace, opts.sessionId);
	const seen = new Set<string>();
	let pending: Promise<void> = Promise.resolve();
	let closed = false;
	const POLL_MS = 1000;

	const processOne = async (taskId: string) => {
		if (seen.has(taskId)) return;
		seen.add(taskId);
		try {
			const raw = await readFile(paths.resultFile(taskId), "utf-8");
			const result = JSON.parse(raw) as DispatchResult;
			const type =
				result.status === "completed" ? "task_completed" : "task_failed";
			await appendFile(
				opts.ledgerPath,
				`${JSON.stringify({
					id: randomUUID(),
					timestamp: new Date().toISOString(),
					type,
					severity: result.status === "completed" ? "info" : "error",
					taskId: result.taskId,
					payload: {
						status: result.status,
						content: result.content,
						error: result.error,
						durationMs: result.durationMs,
						exitCode: result.exitCode,
					},
					metadata: {
						provider: result.providerId,
						durationMs: result.durationMs,
					},
				})}\n`,
				"utf-8",
			);
		} catch {
			// Not fully written yet, or just disappeared. Re-eligible
			// for processing on the next scan.
			seen.delete(taskId);
		}
	};

	const scanAndDrain = async () => {
		if (closed) return;
		let entries: string[];
		try {
			entries = await readdir(paths.results);
		} catch {
			return; // dir disappeared
		}
		for (const e of entries) {
			if (closed) return;
			if (extname(e) !== ".json") continue;
			// Skip atomic-write temp files (`.tmp.<name>.json.<uuid>`).
			if (e.startsWith(".tmp.")) continue;
			const taskId = e.slice(0, -".json".length);
			await processOne(taskId);
		}
	};

	const trigger = () => {
		if (closed) return;
		pending = pending.then(scanAndDrain);
	};

	let watcher: ReturnType<typeof fsWatch> | null = null;
	const attachWatcher = () => {
		try {
			watcher = fsWatch(paths.results, { persistent: false }, trigger);
		} catch {
			setTimeout(() => {
				if (!closed) attachWatcher();
			}, 200).unref();
		}
	};
	attachWatcher();

	// Polling backup: cheap `readdir` once per second so we never
	// strand a result on flaky inotify (NFS, FUSE, some bun versions).
	const poller = setInterval(() => {
		if (closed) return;
		trigger();
	}, POLL_MS);
	poller.unref?.();

	// Initial scan in case results were written before this watcher
	// attached (re-runs of the same session id after a server restart).
	trigger();

	return {
		close() {
			if (closed) return;
			closed = true;
			clearInterval(poller);
			try {
				watcher?.close();
			} catch {
				/* already closed */
			}
		},
	};
}
