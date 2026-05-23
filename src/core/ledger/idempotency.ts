/**
 * Idempotency-Key ledger with 72h JSONL replay (G5.F.2, T3.2).
 *
 * Every task or dispatch carries an idempotency key — a UUID generated
 * at the request boundary. The ledger remembers seen keys (and their
 * result envelopes) for a configurable retention window (default 72h).
 *
 * Use cases:
 *   - Client reconnect after WebSocket / SSE drop: the UI resubmits the
 *     same job with the same key; the ledger returns the cached result
 *     instead of re-dispatching.
 *   - Process restart mid-flight: a crash between "result emitted" and
 *     "result delivered" no longer duplicates work — `load()` rehydrates
 *     the prior keys and `record()` short-circuits.
 *
 * Storage is JSONL on disk (one line per entry) so a forensic operator
 * can `grep` for a key or `tail -f` the ledger. Atomicity for compaction
 * routes through `atomicWriteFile` (mkstemp + fsync + rename, §0.8).
 *
 * Non-goals: this is not a distributed cache. Multiple processes writing
 * the same ledger path racy-append; `record()` is best-effort across
 * processes and authoritative only within one process.
 */
import { appendFile, readFile } from "node:fs/promises";
import { atomicWriteFile } from "../persistence/atomicWrite.js";

export interface IdempotencyEntry {
	key: string;
	at: number; // epoch ms — when first observed
	result: unknown;
}

export interface IdempotencyRecordResult {
	duplicate: boolean;
	/** When `duplicate === true`, the result that was previously stored. */
	prior?: unknown;
}

export interface IdempotencyLedgerOptions {
	/** Retention window in ms. Default = 72 hours per spec G5.F.2. */
	retentionMs?: number;
	/** Clock override for tests. Default = Date.now. */
	now?: () => number;
}

const DEFAULT_RETENTION_MS = 72 * 60 * 60 * 1000;

export class IdempotencyLedger {
	private map = new Map<string, IdempotencyEntry>();
	private retentionMs: number;
	private now: () => number;
	private path: string;

	constructor(path: string, opts: IdempotencyLedgerOptions = {}) {
		this.path = path;
		this.retentionMs = opts.retentionMs ?? DEFAULT_RETENTION_MS;
		this.now = opts.now ?? Date.now;
	}

	/**
	 * Replay the JSONL ledger into memory. Entries past the retention
	 * window are silently dropped (they'll be removed permanently on
	 * the next `compact()`).
	 *
	 * Safe to call multiple times; malformed lines are skipped (same
	 * recovery pattern as `durablePrompt-jsonl::loadEntries`).
	 */
	async load(): Promise<void> {
		let raw: string;
		try {
			raw = await readFile(this.path, "utf-8");
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
			throw err;
		}
		const cutoff = this.now() - this.retentionMs;
		for (const line of raw.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			let parsed: IdempotencyEntry;
			try {
				parsed = JSON.parse(trimmed) as IdempotencyEntry;
			} catch {
				console.warn(
					`[idempotency] skipping unparseable line: ${trimmed.slice(0, 80)}`,
				);
				continue;
			}
			if (typeof parsed.key !== "string" || typeof parsed.at !== "number") {
				continue;
			}
			if (parsed.at < cutoff) continue;
			this.map.set(parsed.key, parsed);
		}
	}

	/**
	 * Record an idempotency key + result. Returns `{ duplicate: true,
	 * prior }` if the key was already seen within the retention window;
	 * otherwise persists the new entry and returns `{ duplicate: false }`.
	 */
	async record(key: string, result: unknown): Promise<IdempotencyRecordResult> {
		const existing = this.map.get(key);
		if (existing && existing.at >= this.now() - this.retentionMs) {
			return { duplicate: true, prior: existing.result };
		}
		const entry: IdempotencyEntry = {
			key,
			at: this.now(),
			result,
		};
		this.map.set(key, entry);
		// Best-effort persistence — never let disk I/O fail a dispatch.
		await appendFile(this.path, `${JSON.stringify(entry)}\n`).catch(() => {
			/* swallowed: in-memory map is still authoritative for this process */
		});
		return { duplicate: false };
	}

	/** Whether a non-expired entry exists for the given key. */
	has(key: string): boolean {
		const entry = this.map.get(key);
		if (!entry) return false;
		return entry.at >= this.now() - this.retentionMs;
	}

	/** Read the prior result for `key`, or `undefined` if absent / expired. */
	get(key: string): unknown | undefined {
		const entry = this.map.get(key);
		if (!entry) return undefined;
		if (entry.at < this.now() - this.retentionMs) return undefined;
		return entry.result;
	}

	/**
	 * Drop expired entries from the in-memory map and rewrite the on-disk
	 * ledger so the file size doesn't grow unboundedly. Atomic via
	 * `atomicWriteFile` — a crash mid-compact either keeps the original
	 * file or replaces it with the compacted body, never a half-written
	 * version (same multica #6 guarantee `durablePrompt-jsonl::compactLedger`
	 * relies on).
	 */
	async compact(): Promise<void> {
		const cutoff = this.now() - this.retentionMs;
		const alive: IdempotencyEntry[] = [];
		for (const entry of this.map.values()) {
			if (entry.at >= cutoff) alive.push(entry);
			else this.map.delete(entry.key);
		}
		const body =
			alive.map((e) => JSON.stringify(e)).join("\n") +
			(alive.length ? "\n" : "");
		await atomicWriteFile(this.path, body);
	}
}
