import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { estimateWorktreeSize } from "../../../../src/core/worktree/gc-tiered/size-estimator";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "apohara-gc-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

test("returns 0 for empty dir", async () => {
  expect(await estimateWorktreeSize(dir)).toBe(0);
});

test("sums file sizes recursively", async () => {
  await mkdir(join(dir, "src"), { recursive: true });
  await writeFile(join(dir, "a.txt"), "x".repeat(100));
  await writeFile(join(dir, "src", "b.txt"), "y".repeat(200));
  const size = await estimateWorktreeSize(dir);
  expect(size).toBeGreaterThanOrEqual(300);
});
