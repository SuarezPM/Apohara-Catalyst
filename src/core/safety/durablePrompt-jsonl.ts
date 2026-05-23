/**
 * JSONL ledger helpers for {@link DurablePromptStore} (spec §4.6).
 *
 * The store appends one line per state transition (`request` or `response`)
 * so a fresh process can replay the ledger and reconstruct the in-memory
 * maps after a crash / restart / React unmount.
 *
 * Compaction is provided but not yet called automatically — the ledger is
 * append-only until a future caller decides to garbage-collect consumed
 * prompts.
 */
import { appendFile, readFile } from "node:fs/promises";
import { atomicWriteFile } from "../persistence/atomicWrite.js";
import type { PermissionRequest, PermissionResponse } from "./durablePrompt.js";

export type LedgerEntry =
  | { kind: "request"; data: PermissionRequest }
  | { kind: "response"; data: PermissionResponse };

// Best-effort append: no fsync, order of concurrent appends not guaranteed.
// See durablePrompt.ts header for the full durability policy.
export async function appendEntry(
  path: string,
  entry: LedgerEntry,
): Promise<void> {
  await appendFile(path, JSON.stringify(entry) + "\n");
}

export async function loadEntries(path: string): Promise<LedgerEntry[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const entries: LedgerEntry[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed) as LedgerEntry);
    } catch {
      // Best-effort recovery: skip corrupted line and keep going so a
      // single bad write doesn't poison the whole ledger. Warn so a
      // debug session ("¿por qué no se restaura mi prompt?") can tell
      // a corrupted line apart from ENOENT / "no entry". Same pattern
      // as src/core/dispatch/result-watcher.ts.
      console.warn(
        `[durablePrompt] skipping unparseable ledger line: ${trimmed.slice(0, 80)}`,
      );
    }
  }
  return entries;
}

export async function compactLedger(
  path: string,
  alive: LedgerEntry[],
): Promise<void> {
  const body =
    alive.map((e) => JSON.stringify(e)).join("\n") + (alive.length ? "\n" : "");
  await atomicWriteFile(path, body);
}
