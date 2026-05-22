import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, writeFile, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlanStatusCache } from "../../../src/core/spec/planStatusCache";

let workDir: string;
let cache: PlanStatusCache;
beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "apohara-cache-"));
  cache = new PlanStatusCache();
});
afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function writePlan(dir: string, name: string, content: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, content);
  return path;
}

const PLAN_TEMPLATE = (title: string) => [
  "---",
  `title: ${title}`,
  "status: active",
  "---",
  "",
  "## Objective",
  "Do something useful.",
  "",
].join("\n");

test("first getFast does full parse + caches result", async () => {
  const path = await writePlan(workDir, "p.md", PLAN_TEMPLATE("First"));
  const plan = await cache.getFast(path);
  expect(plan.title).toBe("First");
  expect(cache.size()).toBe(1);
});

test("second getFast returns cached when mtime unchanged", async () => {
  const path = await writePlan(workDir, "p.md", PLAN_TEMPLATE("Stable"));
  const plan1 = await cache.getFast(path);
  const plan2 = await cache.getFast(path);
  expect(plan2.planId).toBe(plan1.planId);
  expect(cache.parseCount()).toBe(1);
});

test("reparses when mtime changes AND content SHA changes (body edit)", async () => {
  const path = await writePlan(workDir, "p.md", PLAN_TEMPLATE("Edit"));
  await cache.getFast(path);

  await writeFile(path, PLAN_TEMPLATE("Edit") + "\n## Context\nNew body.\n");
  const now = new Date();
  await utimes(path, now, new Date(now.getTime() + 1000));

  const plan2 = await cache.getFast(path);
  expect(plan2.context).toContain("New body");
  expect(cache.parseCount()).toBe(2);
});

test("skips full parse when only mtime changed but SHA matches (touch)", async () => {
  const path = await writePlan(workDir, "p.md", PLAN_TEMPLATE("Touch"));
  await cache.getFast(path);

  await utimes(path, new Date(), new Date(Date.now() + 1000));

  await cache.getFast(path);
  expect(cache.parseCount()).toBe(1);
});

test("clear evicts cached entry", async () => {
  const path = await writePlan(workDir, "p.md", PLAN_TEMPLATE("Evict"));
  await cache.getFast(path);
  cache.clear(path);
  expect(cache.size()).toBe(0);

  await cache.getFast(path);
  expect(cache.parseCount()).toBe(2);
});