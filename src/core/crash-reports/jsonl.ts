/**
 * JSONL append-only log for local crash reports (spec §0.33).
 *
 * Local-first: nothing is shipped off-machine. The log lives next to the
 * other per-user telemetry under `~/.apohara/` and is mode 0600 so other
 * users on the host cannot read it (crash reports embed stack traces that
 * may leak file paths or workspace names).
 *
 * Durability policy mirrors `src/core/safety/durablePrompt-jsonl.ts`:
 * best-effort append, no fsync, no ordering guarantee under concurrent
 * writers. We accept that trade-off because a lost crash report is a
 * smaller failure than blocking the crash handler on disk fsync.
 *
 * §0.8 (atomic-write) does NOT apply here: atomic-write replaces a whole
 * file, but this log is append-only — using mkstemp+rename per append
 * would destroy previous entries on every write. Same reasoning as the
 * durable-prompt ledger and the existing JSONL sinks across the codebase.
 */
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface CrashReport {
  /** Unix epoch milliseconds when the crash was captured. */
  ts: number;
  /** Anonymous install identifier (re-exported from telemetry — see `./installId.ts`). */
  installId: string;
  /** Top-level error message. */
  message: string;
  /** Full stack trace (may be empty for crashes captured without one). */
  stack: string;
  /** Arbitrary contextual metadata (sprint, route, etc.). */
  context: Record<string, unknown>;
}

/**
 * Append a single crash report to the JSONL log at `path`. Creates the
 * parent directory if missing and writes with mode 0600 on first create.
 *
 * Note: `appendFile`'s `mode` is only honored when the file does not yet
 * exist (Node semantics). Subsequent appends inherit the original mode,
 * which is the desired behaviour — once 0600, stays 0600.
 */
export async function appendCrashReport(
  path: string,
  report: CrashReport,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, JSON.stringify(report) + "\n", { mode: 0o600 });
}

/**
 * Load every crash report from `path`. Returns `[]` if the file does not
 * exist. Corrupted lines (one bad write should not poison the whole log)
 * are skipped with a warning — same recovery pattern as
 * `durablePrompt-jsonl.ts` and `dispatch/result-watcher.ts`.
 */
export async function loadCrashReports(path: string): Promise<CrashReport[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const reports: CrashReport[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      reports.push(JSON.parse(trimmed) as CrashReport);
    } catch {
      console.warn(
        `[crash-reports] skipping unparseable line: ${trimmed.slice(0, 80)}`,
      );
    }
  }
  return reports;
}
