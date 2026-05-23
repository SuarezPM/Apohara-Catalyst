/**
 * Multica #8 — workspace storage tiered to manage disk pressure.
 *
 * Three tiers in priority order (most to least valuable):
 *   full:           complete worktree (~50-500MB each, full git checkout + node_modules + target/)
 *   artifact-only:  only `target/release/`, `dist/`, build outputs (~5-50MB)
 *   metadata-only:  task.json + result.json + JSONL log (~1-10KB)
 *
 * GC policy: when total worktree storage exceeds threshold, downgrade
 * oldest-accessed worktree Tier1→2→3. Re-upgrade on access (lazy).
 */

export type WorktreeTier = "full" | "artifact-only" | "metadata-only";

export interface TieredWorktree {
  id: string;
  path: string;
  tier: WorktreeTier;
  sizeBytes: number;
  lastAccessedMs: number;
}

export interface GcPolicy {
  totalBudgetBytes: number;
  fullTierMaxAgeMs: number;
  artifactTierMaxAgeMs: number;
}

export const DEFAULT_GC_POLICY: GcPolicy = {
  totalBudgetBytes: 10 * 1024 * 1024 * 1024, // 10GB
  fullTierMaxAgeMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  artifactTierMaxAgeMs: 30 * 24 * 60 * 60 * 1000, // 30 days
};
