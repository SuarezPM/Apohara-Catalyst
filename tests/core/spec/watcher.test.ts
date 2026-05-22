import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, writeFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listenerRegistry } from "../../../src/store/listeners";
import { PlanStatusCache } from "../../../src/core/spec/planStatusCache";
import { startPlanWatcher } from "../../../src/core/spec/watcher";

let workDir: string;
beforeEach(async () => {
  listenerRegistry.reset();
  workDir = await mkdtemp(join(tmpdir(), "apohara-watch-"));
});
afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

const PLAN = (title: string) => [
  "---",
  `title: ${title}`,
  "status: active",
  "---",
  "## Objective",
  "Do it.",
  "",
].join("\n");

async function waitForEvent(eventName: string, timeoutMs: number = 2000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`timeout waiting for ${eventName}`)), timeoutMs);
    const handle = listenerRegistry.register(eventName, (payload) => {
      clearTimeout(timeout);
      handle.dispose();
      resolve(payload);
    });
  });
}

test("emits apohara://plan-added when a new .md file appears", async () => {
  const cache = new PlanStatusCache();
  const watcher = await startPlanWatcher({ rootPath: workDir, cache, debounceMs: 50 });

  const addedPromise = waitForEvent("apohara://plan-added");
  await new Promise(r => setTimeout(r, 100)); // let watcher arm
  await writeFile(join(workDir, "new.md"), PLAN("New"));

  const payload = await addedPromise as { filepath: string };
  expect(payload.filepath).toContain("new.md");

  await watcher.close();
});

test("emits apohara://plan-changed when an existing .md file changes", async () => {
  const cache = new PlanStatusCache();
  await writeFile(join(workDir, "existing.md"), PLAN("Existing"));

  const watcher = await startPlanWatcher({ rootPath: workDir, cache, debounceMs: 50 });
  await new Promise(r => setTimeout(r, 200)); // let watcher discover existing files first

  const changedPromise = waitForEvent("apohara://plan-changed");
  await writeFile(join(workDir, "existing.md"), PLAN("Existing-Updated"));

  const payload = await changedPromise as { filepath: string };
  expect(payload.filepath).toContain("existing.md");

  await watcher.close();
});

test("emits apohara://plan-removed when a .md file is deleted", async () => {
  const cache = new PlanStatusCache();
  await writeFile(join(workDir, "doomed.md"), PLAN("Doomed"));

  const watcher = await startPlanWatcher({ rootPath: workDir, cache, debounceMs: 50 });
  await new Promise(r => setTimeout(r, 200));

  const removedPromise = waitForEvent("apohara://plan-removed");
  await unlink(join(workDir, "doomed.md"));

  const payload = await removedPromise as { filepath: string };
  expect(payload.filepath).toContain("doomed.md");

  await watcher.close();
});

test("invalidates cache entry on change", async () => {
  const cache = new PlanStatusCache();
  const path = join(workDir, "cached.md");
  await writeFile(path, PLAN("Cached"));

  // Prime the cache
  await cache.getFast(path);
  expect(cache.size()).toBe(1);

  const watcher = await startPlanWatcher({ rootPath: workDir, cache, debounceMs: 50 });
  await new Promise(r => setTimeout(r, 200));

  await writeFile(path, PLAN("Cached") + "\n## Context\nNew.\n");
  await new Promise(r => setTimeout(r, 300)); // let watcher process the event

  // Cache should be invalidated (cleared by watcher)
  // Test by checking parseCount AFTER fresh getFast
  await cache.getFast(path);
  expect(cache.parseCount()).toBeGreaterThanOrEqual(2);  // 1 prime + 1+ after invalidation

  await watcher.close();
});