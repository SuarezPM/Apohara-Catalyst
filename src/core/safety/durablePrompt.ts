/**
 * Durable permission prompt store per spec §4.6.
 *
 * Two backing modes share the same public shape:
 *  - In-memory (default — `new DurablePromptStore()`): identical to the
 *    Stage 5 implementation, no I/O.
 *  - JSONL-backed (`new DurablePromptStore({ ledgerPath })`): every
 *    enqueueRequest / setResponse is also appended to a JSONL file so a
 *    fresh process can call `load()` and recover pending prompts and
 *    already-recorded responses across restarts (the "Stage 8" durability
 *    requirement — prompts survive a React unmount/remount or a Bun
 *    process crash).
 *
 * The on-disk appends are best-effort and fire-and-forget: durability
 * never blocks the synchronous call sites that drive the UI. A caller
 * that wants strong durability guarantees should await on a future
 * explicit `flush()` API instead.
 */

import { appendEntry, compactLedger, loadEntries, type LedgerEntry } from "./durablePrompt-jsonl.js";

export interface PermissionRequest {
  request_id: string;
  inv: { tool: string; input: Record<string, unknown> };
  suggested_pattern: string;
  available_scopes: ("once" | "session" | "always")[];
  created_at: number;
}

export interface PermissionResponse {
  request_id: string;
  decision: "allow" | "deny";
  scope?: "once" | "session" | "always";
  /** The pattern the user actually approved — may differ from suggested. */
  pattern?: string;
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes per spec.
const DEFAULT_POLL_MS = 100;

export interface DurablePromptStoreOptions {
  /**
   * When set, the store appends every enqueueRequest / setResponse to this
   * JSONL ledger and can recover state on `load()`. When unset, behavior is
   * identical to the previous in-memory implementation (no I/O).
   */
  ledgerPath?: string;
}

export class DurablePromptStore {
  private pending = new Map<string, PermissionRequest>();
  private responses = new Map<string, PermissionResponse>();
  private ledgerPath?: string;

  constructor(opts: DurablePromptStoreOptions = {}) {
    this.ledgerPath = opts.ledgerPath;
  }

  enqueueRequest(req: PermissionRequest): void {
    this.pending.set(req.request_id, req);
    if (this.ledgerPath) {
      void appendEntry(this.ledgerPath, { kind: "request", data: req }).catch(
        () => {
          /* best-effort durability — never block the UI on disk */
        },
      );
    }
  }

  setResponse(resp: PermissionResponse): void {
    this.responses.set(resp.request_id, resp);
    if (this.ledgerPath) {
      void appendEntry(this.ledgerPath, { kind: "response", data: resp }).catch(
        () => {
          /* best-effort durability */
        },
      );
    }
  }

  /**
   * True when a request was enqueued but no matching response has been
   * recorded yet (and the prompt hasn't been consumed by a successful
   * `waitForResponse`).
   */
  isPending(request_id: string): boolean {
    return this.pending.has(request_id) && !this.responses.has(request_id);
  }

  /**
   * Replay the JSONL ledger into the in-memory maps. Safe to call multiple
   * times: each entry just re-sets the corresponding map slot. No-op when
   * no ledgerPath was configured.
   */
  async load(): Promise<void> {
    if (!this.ledgerPath) return;
    const entries = await loadEntries(this.ledgerPath);
    for (const entry of entries) {
      if (entry.kind === "request") {
        this.pending.set(entry.data.request_id, entry.data);
      } else {
        this.responses.set(entry.data.request_id, entry.data);
      }
    }
  }

  /**
   * Block until a response for `request_id` is recorded, or until
   * `timeoutMs` elapses. On success the prompt is consumed (removed
   * from both in-memory maps) and the response is returned. On timeout
   * the pending entry is dropped and `null` is returned.
   *
   * NOTE on durability: consume() removes the entry from the in-memory
   * maps but the JSONL ledger retains the full history. A `load()`
   * after a restart re-resurrects consumed entries as pending — the
   * response is also re-loaded and will be re-consumed by the next
   * waitForResponse. For most cases (deny + once-scope) this is OK.
   * For (allow + session) a future `compactLedger()` invocation at
   * consume-time would prevent the re-prompt. See `compactLedger()`
   * in durablePrompt-jsonl.ts.
   */
  async waitForResponse(
    request_id: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
    pollMs: number = DEFAULT_POLL_MS,
  ): Promise<PermissionResponse | null> {
    const deadline = Date.now() + timeoutMs;
    // Fast path: response already present.
    const immediate = this.responses.get(request_id);
    if (immediate) {
      this.consume(request_id);
      return immediate;
    }

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, pollMs));
      const r = this.responses.get(request_id);
      if (r) {
        this.consume(request_id);
        return r;
      }
    }
    // Timeout — drop the pending entry so `listPending()` doesn't keep
    // reporting it as awaiting user input forever.
    this.pending.delete(request_id);
    return null;
  }

  /**
   * Remove a fully-handled prompt (responded + delivered) from both
   * maps. Previously `pending` / `responses` only ever grew; over a long
   * session this both wasted memory and made `listPending()` lie about
   * what was actually awaiting input.
   *
   * G5.F.10 — best-effort compactLedger auto-invoke. The pre-G5.F.10
   * version retained the consumed entry in the JSONL ledger, so a
   * restart would re-resurrect already-answered prompts as pending and
   * the user would see "Allow Bash(npm test:*)?" a second time even
   * after they had previously approved it.
   *
   * Compaction runs asynchronously and never blocks `consume()` (which
   * itself runs on the synchronous waitForResponse code path that drives
   * the UI). Errors are swallowed — the in-memory state is already
   * correct; a failed compact only delays the cleanup until the next
   * consume.
   */
  private consume(request_id: string): void {
    this.pending.delete(request_id);
    this.responses.delete(request_id);
    if (this.ledgerPath) {
      void this.scheduleCompact().catch(() => {
        /* best-effort — in-memory state is already authoritative */
      });
    }
  }

  /**
   * Single-flight compaction: rebuild the on-disk ledger from the live
   * in-memory state (pending requests + un-consumed responses). Any
   * already-consumed entry naturally drops out. If a compact is already
   * running we coalesce with it.
   */
  private compactInFlight: Promise<void> | null = null;
  private async scheduleCompact(): Promise<void> {
    if (!this.ledgerPath) return;
    if (this.compactInFlight) return this.compactInFlight;
    const path = this.ledgerPath;
    const alive: LedgerEntry[] = [
      ...Array.from(this.pending.values()).map(
        (data) => ({ kind: "request" as const, data }),
      ),
      ...Array.from(this.responses.values()).map(
        (data) => ({ kind: "response" as const, data }),
      ),
    ];
    this.compactInFlight = compactLedger(path, alive).finally(() => {
      this.compactInFlight = null;
    });
    return this.compactInFlight;
  }

  listPending(): PermissionRequest[] {
    return Array.from(this.pending.values());
  }
}
