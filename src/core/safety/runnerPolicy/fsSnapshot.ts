import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { Glob } from "bun";

export interface FileSnapshot {
  path: string;
  sha256: string;
  size: number;
}

export interface SnapshotResult {
  files: FileSnapshot[];
}

export async function snapshotProtectedPaths(
  workspace: string,
  patterns: string[],
): Promise<SnapshotResult> {
  const files: FileSnapshot[] = [];
  for (const pattern of patterns) {
    const glob = new Glob(pattern);
    for await (const path of glob.scan({ cwd: workspace })) {
      const full = join(workspace, path);
      try {
        const content = await readFile(full);
        const sha256 = createHash("sha256").update(content).digest("hex");
        const s = await stat(full);
        files.push({ path, sha256, size: s.size });
      } catch {
        // missing files are not snapshot
      }
    }
  }
  return { files };
}

export interface Violation {
  path: string;
  before: string;
  after: string;
}

export async function detectViolations(
  before: SnapshotResult,
  workspace: string,
): Promise<Violation[]> {
  const violations: Violation[] = [];
  for (const snap of before.files) {
    const full = join(workspace, snap.path);
    try {
      const content = await readFile(full);
      const sha256 = createHash("sha256").update(content).digest("hex");
      if (sha256 !== snap.sha256) {
        violations.push({ path: snap.path, before: snap.sha256, after: sha256 });
      }
    } catch {
      violations.push({ path: snap.path, before: snap.sha256, after: "<deleted>" });
    }
  }
  return violations;
}