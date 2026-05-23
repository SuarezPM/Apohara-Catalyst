import { expect, test } from "bun:test";
import { runGcTick } from "../../../../src/core/worktree/gc-tiered/orchestrator";
import type { TieredWorktree, GcPolicy } from "../../../../src/core/worktree/gc-tiered/types";

const policy: GcPolicy = {
  totalBudgetBytes: 1000,
  fullTierMaxAgeMs: 1000,
  artifactTierMaxAgeMs: 5000,
};

test("returns no-op when under budget", () => {
  const now = 10_000;
  const wts: TieredWorktree[] = [
    { id: "a", path: "/a", tier: "full", sizeBytes: 100, lastAccessedMs: now - 500 },
  ];
  const actions = runGcTick(wts, policy, now);
  expect(actions).toEqual([]);
});

test("downgrades oldest worktree when over budget", () => {
  const now = 10_000;
  const wts: TieredWorktree[] = [
    { id: "old", path: "/old", tier: "full", sizeBytes: 800, lastAccessedMs: now - 5000 },
    { id: "new", path: "/new", tier: "full", sizeBytes: 800, lastAccessedMs: now - 500 },
  ];
  const actions = runGcTick(wts, policy, now);
  expect(actions[0]).toMatchObject({ id: "old", from: "full", to: "artifact-only" });
});

test("downgrades full → artifact when age exceeds fullTierMaxAgeMs even under budget", () => {
  const now = 10_000;
  const wts: TieredWorktree[] = [
    { id: "stale", path: "/x", tier: "full", sizeBytes: 100, lastAccessedMs: now - 2000 },
  ];
  const actions = runGcTick(wts, policy, now);
  expect(actions[0]).toMatchObject({ id: "stale", from: "full", to: "artifact-only" });
});
