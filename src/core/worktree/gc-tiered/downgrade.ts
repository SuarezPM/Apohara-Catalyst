import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { WorktreeTier } from "./types.js";

const ARTIFACT_KEEP = new Set(["target", "dist", ".next", "build", "out"]);
const METADATA_KEEP = new Set(["task.json", "result.json", "agent.log", "manifest.json"]);

export async function downgradeWorktree(
  path: string,
  from: WorktreeTier,
  to: WorktreeTier,
): Promise<void> {
  // Always preserve metadata files at root regardless of tier.
  if (to === "artifact-only") {
    const entries = await readdir(path, { withFileTypes: true });
    for (const e of entries) {
      const isArtifact = e.isDirectory() && ARTIFACT_KEEP.has(e.name);
      const isMetadata = e.isFile() && METADATA_KEEP.has(e.name);
      if (!isArtifact && !isMetadata) {
        await rm(join(path, e.name), { recursive: true, force: true });
      }
    }
  } else if (to === "metadata-only") {
    const entries = await readdir(path, { withFileTypes: true });
    for (const e of entries) {
      const isMetadata = e.isFile() && METADATA_KEEP.has(e.name);
      if (!isMetadata) {
        await rm(join(path, e.name), { recursive: true, force: true });
      }
    }
  }
  // Upgrade paths (metadata-only → full, etc.) are noops — they require
  // recomputation from git which is out of scope for downgradeWorktree.
}
