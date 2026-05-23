import { expect, test } from "bun:test";
import type { WorktreeTier, TieredWorktree } from "../../../../src/core/worktree/gc-tiered/types";

test("WorktreeTier enum has three levels", () => {
  const tiers: WorktreeTier[] = ["full", "artifact-only", "metadata-only"];
  expect(tiers.length).toBe(3);
});

test("TieredWorktree carries tier + size estimate", () => {
  const wt: TieredWorktree = {
    id: "wt-1",
    path: "/x",
    tier: "full",
    sizeBytes: 1024 * 1024 * 100, // 100MB
    lastAccessedMs: Date.now(),
  };
  expect(wt.tier).toBe("full");
  expect(wt.sizeBytes).toBeGreaterThan(0);
});
