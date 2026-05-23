import type { TieredWorktree, WorktreeTier, GcPolicy } from "./types.js";

export interface GcAction {
  id: string;
  from: WorktreeTier;
  to: WorktreeTier;
  reason: "budget" | "age";
}

export function runGcTick(
  worktrees: TieredWorktree[],
  policy: GcPolicy,
  nowMs: number,
): GcAction[] {
  const actions: GcAction[] = [];

  // Pass 1: age-based downgrades.
  for (const wt of worktrees) {
    const age = nowMs - wt.lastAccessedMs;
    if (wt.tier === "full" && age > policy.fullTierMaxAgeMs) {
      actions.push({ id: wt.id, from: "full", to: "artifact-only", reason: "age" });
    } else if (wt.tier === "artifact-only" && age > policy.artifactTierMaxAgeMs) {
      actions.push({ id: wt.id, from: "artifact-only", to: "metadata-only", reason: "age" });
    }
  }

  // Pass 2: budget-based downgrades on remaining full-tier oldest first.
  const totalBytes = worktrees.reduce((acc, w) => acc + w.sizeBytes, 0);
  if (totalBytes > policy.totalBudgetBytes) {
    const candidates = worktrees
      .filter(w => w.tier === "full" && !actions.some(a => a.id === w.id))
      .sort((a, b) => a.lastAccessedMs - b.lastAccessedMs);
    for (const wt of candidates) {
      actions.push({ id: wt.id, from: "full", to: "artifact-only", reason: "budget" });
      // For simplicity: one downgrade per tick. Caller invokes tick again.
      break;
    }
  }

  return actions;
}
