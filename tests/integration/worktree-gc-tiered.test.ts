import { expect, test } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGcTick } from "../../src/core/worktree/gc-tiered/orchestrator";
import { downgradeWorktree } from "../../src/core/worktree/gc-tiered/downgrade";
import { estimateWorktreeSize } from "../../src/core/worktree/gc-tiered/size-estimator";

test("end-to-end: scan → tick → downgrade → re-scan under budget", async () => {
  const root = await mkdtemp(join(tmpdir(), "apohara-gc-e2e-"));
  try {
    // Set up 2 fake worktrees: 1 old, 1 new
    const old = join(root, "wt-old");
    const newer = join(root, "wt-new");
    await mkdir(join(old, "target", "release"), { recursive: true });
    await mkdir(join(old, "node_modules"), { recursive: true });
    await writeFile(join(old, "task.json"), "{}");
    await writeFile(join(old, "node_modules", "big"), "x".repeat(2000));
    await mkdir(join(newer, "src"), { recursive: true });
    await writeFile(join(newer, "task.json"), "{}");

    const now = Date.now();
    const wts = [
      { id: "old", path: old, tier: "full" as const, sizeBytes: await estimateWorktreeSize(old), lastAccessedMs: now - 1_000_000 },
      { id: "new", path: newer, tier: "full" as const, sizeBytes: await estimateWorktreeSize(newer), lastAccessedMs: now - 100 },
    ];

    const policy = {
      totalBudgetBytes: 100, // tiny — both exceed
      fullTierMaxAgeMs: 500_000, // 8min
      artifactTierMaxAgeMs: 30 * 24 * 60 * 60 * 1000,
    };

    const actions = runGcTick(wts, policy, now);
    expect(actions.length).toBeGreaterThan(0);
    expect(actions[0].id).toBe("old");

    await downgradeWorktree(old, actions[0].from, actions[0].to);

    const sizeAfter = await estimateWorktreeSize(old);
    expect(sizeAfter).toBeLessThan(2000); // node_modules dropped
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
