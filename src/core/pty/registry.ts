/**
 * PTY registry — server-side spawn / output-buffer / write-input /
 * resize / kill for embedded terminal sessions. Lifted from orca's
 * `src/relay/pty-handler.ts:1-681` (the bits that matter for a
 * single-process bun server).
 *
 * Each PTY carries a rolling 100 KiB replay buffer so a UI tab that
 * re-attaches mid-run can rebuild the screen without losing the
 * prior output. The cap matches orca's `REPLAY_BUFFER_MAX` so the
 * memory footprint is bounded even with hundreds of long-running
 * sessions.
 *
 * Public surface:
 *   - `spawnPty(opts)` → PtyHandle
 *   - `writePty(id, data)` / `resizePty(id, cols, rows)` /
 *     `killPty(id)` / `getPty(id)` / `listPtys()`
 *   - `onPtyData(id, listener)` / `onPtyExit(id, listener)` — fires
 *     for every new chunk / exit event after the listener attaches.
 *
 * Listeners receive ONLY data that arrives AFTER they attach; new
 * subscribers should call `getReplay(id)` first to bootstrap their
 * view, then start consuming live data.
 */
import { EventEmitter } from "node:events";
import { spawn as ptySpawn, type IPty } from "node-pty";
import { randomUUID } from "node:crypto";

const REPLAY_BUFFER_MAX = 100 * 1024;
const MAX_PTYS = 50;

export interface SpawnPtyOptions {
	command: string;
	args?: string[];
	cwd?: string;
	env?: Record<string, string>;
	cols?: number;
	rows?: number;
	/** Optional caller-supplied id. Generated if absent. */
	id?: string;
	/** Optional sessionId for the orchestrator to correlate. */
	sessionId?: string;
	/** Optional taskId for the orchestrator to correlate. */
	taskId?: string;
}

export interface PtyHandle {
	id: string;
	sessionId?: string;
	taskId?: string;
	command: string;
	args: string[];
	cols: number;
	rows: number;
	startedAt: number;
	exitCode?: number;
	exitedAt?: number;
	pid: number;
}

interface PtyEntry {
	handle: PtyHandle;
	pty: IPty;
	replay: string[];
	replayBytes: number;
	emitter: EventEmitter;
	closed: boolean;
}

const registry = new Map<string, PtyEntry>();

function trimReplay(entry: PtyEntry): void {
	while (entry.replayBytes > REPLAY_BUFFER_MAX && entry.replay.length > 0) {
		const dropped = entry.replay.shift();
		if (dropped) entry.replayBytes -= dropped.length;
	}
}

export function spawnPty(opts: SpawnPtyOptions): PtyHandle {
	if (registry.size >= MAX_PTYS) {
		throw new Error(`pty registry full (cap=${MAX_PTYS}). Kill an existing pty first.`);
	}
	const id = opts.id ?? `pty-${randomUUID().slice(0, 12)}`;
	const cols = opts.cols ?? 120;
	const rows = opts.rows ?? 30;
	const args = opts.args ?? [];

	const pty = ptySpawn(opts.command, args, {
		name: "xterm-256color",
		cols,
		rows,
		cwd: opts.cwd ?? process.cwd(),
		env: { ...(opts.env ?? (process.env as Record<string, string>)) },
	});

	const emitter = new EventEmitter();
	const handle: PtyHandle = {
		id,
		sessionId: opts.sessionId,
		taskId: opts.taskId,
		command: opts.command,
		args,
		cols,
		rows,
		startedAt: Date.now(),
		pid: pty.pid,
	};
	const entry: PtyEntry = {
		handle,
		pty,
		replay: [],
		replayBytes: 0,
		emitter,
		closed: false,
	};
	registry.set(id, entry);

	pty.onData((chunk) => {
		// Capture even when the entry is marked closed: node-pty can
		// deliver buffered output AFTER the onExit callback fires
		// (verified empirically with `sh -c "echo X"` where the child
		// exits microseconds after writing — onExit beats the final
		// onData callback). Dropping post-exit chunks would leave the
		// replay buffer empty for fast commands.
		entry.replay.push(chunk);
		entry.replayBytes += chunk.length;
		trimReplay(entry);
		emitter.emit("data", chunk);
	});
	pty.onExit(({ exitCode }) => {
		handle.exitCode = exitCode;
		handle.exitedAt = Date.now();
		emitter.emit("exit", exitCode);
		entry.closed = true;
		// Keep the entry in the registry for one minute so a re-attaching
		// UI can see the final output + exit code before it's GC'd.
		setTimeout(() => {
			registry.delete(id);
		}, 60_000).unref?.();
	});

	return handle;
}

export function getPty(id: string): PtyHandle | undefined {
	return registry.get(id)?.handle;
}

export function listPtys(): PtyHandle[] {
	return [...registry.values()].map((e) => e.handle);
}

export function getReplay(id: string): string {
	const entry = registry.get(id);
	if (!entry) return "";
	return entry.replay.join("");
}

export function writePty(id: string, data: string): boolean {
	const entry = registry.get(id);
	if (!entry || entry.closed) return false;
	entry.pty.write(data);
	return true;
}

export function resizePty(id: string, cols: number, rows: number): boolean {
	const entry = registry.get(id);
	if (!entry || entry.closed) return false;
	entry.pty.resize(cols, rows);
	entry.handle.cols = cols;
	entry.handle.rows = rows;
	return true;
}

export function killPty(id: string, signal: NodeJS.Signals = "SIGTERM"): boolean {
	const entry = registry.get(id);
	if (!entry || entry.closed) return false;
	try {
		entry.pty.kill(signal);
	} catch {
		/* already dead */
	}
	return true;
}

export function onPtyData(
	id: string,
	listener: (chunk: string) => void,
): () => void {
	const entry = registry.get(id);
	if (!entry) return () => {};
	// Deliver the existing replay buffer synchronously so a late
	// subscriber rebuilds its view from where the PTY currently is —
	// otherwise data that arrived between `spawnPty()` returning and
	// the subscriber attaching would be lost. The HTTP SSE handler
	// uses `getReplay()` directly for the same reason; in-process
	// callers (tests, future Tauri renderer) get the same guarantee here.
	if (entry.replayBytes > 0) {
		const joined = entry.replay.join("");
		if (joined) listener(joined);
	}
	entry.emitter.on("data", listener);
	return () => entry.emitter.off("data", listener);
}

export function onPtyExit(
	id: string,
	listener: (exitCode: number) => void,
): () => void {
	const entry = registry.get(id);
	if (!entry) return () => {};
	if (entry.closed && entry.handle.exitCode !== undefined) {
		// Already exited — fire synchronously next tick so the caller's
		// listener consistently runs after their handler is registered.
		const code = entry.handle.exitCode;
		setImmediate(() => listener(code));
		return () => {};
	}
	entry.emitter.on("exit", listener);
	return () => entry.emitter.off("exit", listener);
}

/** Test-only: clear the registry. */
export function _clearRegistry(): void {
	for (const id of [...registry.keys()]) {
		killPty(id, "SIGKILL");
		registry.delete(id);
	}
}
