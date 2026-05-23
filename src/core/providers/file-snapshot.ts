/**
 * File snapshot before/after per spec §4.5 (nimbalyst #1.5).
 *
 * `snapshotDir(path)` walks a workspace and records each file's
 * (path, sha256, size, mtimeMs). `diffSnapshots(a, b)` produces sets of
 * added / modified / deleted paths so the verification + plans pages can
 * show "what changed during this agent turn".
 *
 * Hard-coded skip patterns: `.git`, `node_modules`, `target`, `dist`,
 * `.next`, `__pycache__`. These are the directories a CLI-wrapper agent
 * MUST NOT diff — they're either huge or auto-regenerated.
 *
 * G5.A.8 extends this module with a streaming variant.
 */
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

export interface FileEntry {
  sha256: string;
  size: number;
  mtimeMs: number;
}

export interface DirSnapshot {
  root: string;
  takenAt: number;
  files: Record<string, FileEntry>;
}

export interface SnapshotDiff {
  added: string[];
  modified: string[];
  deleted: string[];
}

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "target",
  "dist",
  ".next",
  "__pycache__",
  ".turbo",
  ".cache",
]);

/** Recursively walk a directory yielding absolute file paths. */
async function* walk(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

export async function snapshotDir(root: string): Promise<DirSnapshot> {
  const files: Record<string, FileEntry> = {};
  for await (const full of walk(root)) {
    const rel = relative(root, full).split(sep).join("/");
    let stats;
    try {
      stats = await stat(full);
    } catch {
      continue;
    }
    let buf: Buffer;
    try {
      buf = await readFile(full);
    } catch {
      continue;
    }
    const hash = createHash("sha256").update(buf).digest("hex");
    files[rel] = {
      sha256: hash,
      size: stats.size,
      mtimeMs: stats.mtimeMs,
    };
  }
  return { root, takenAt: Date.now(), files };
}

export function diffSnapshots(
  before: DirSnapshot,
  after: DirSnapshot,
): SnapshotDiff {
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  const beforePaths = new Set(Object.keys(before.files));
  const afterPaths = new Set(Object.keys(after.files));
  for (const p of afterPaths) {
    if (!beforePaths.has(p)) {
      added.push(p);
    } else {
      const a = before.files[p];
      const b = after.files[p];
      if (a && b && a.sha256 !== b.sha256) modified.push(p);
    }
  }
  for (const p of beforePaths) {
    if (!afterPaths.has(p)) deleted.push(p);
  }
  added.sort();
  modified.sort();
  deleted.sort();
  return { added, modified, deleted };
}
