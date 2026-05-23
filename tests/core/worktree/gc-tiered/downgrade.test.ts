import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downgradeWorktree } from "../../../../src/core/worktree/gc-tiered/downgrade";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "apohara-dg-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

test("downgrade full → artifact-only keeps target/ + dist/ + drops node_modules + src", async () => {
  await mkdir(join(dir, "target", "release"), { recursive: true });
  await mkdir(join(dir, "dist"), { recursive: true });
  await mkdir(join(dir, "node_modules", "x"), { recursive: true });
  await mkdir(join(dir, "src"), { recursive: true });
  await writeFile(join(dir, "target", "release", "bin"), "binary");
  await writeFile(join(dir, "dist", "out.js"), "x");
  await writeFile(join(dir, "node_modules", "x", "p.json"), "x");
  await writeFile(join(dir, "src", "code.ts"), "x");
  await writeFile(join(dir, "task.json"), "x");

  await downgradeWorktree(dir, "full", "artifact-only");

  const remaining = await readdir(dir);
  expect(remaining).toContain("target");
  expect(remaining).toContain("dist");
  expect(remaining).not.toContain("node_modules");
  expect(remaining).not.toContain("src");
  expect(remaining).toContain("task.json"); // task metadata always preserved
});

test("downgrade artifact-only → metadata-only keeps task.json + log + drops target/", async () => {
  await mkdir(join(dir, "target"), { recursive: true });
  await writeFile(join(dir, "target", "bin"), "x");
  await writeFile(join(dir, "task.json"), "x");
  await writeFile(join(dir, "result.json"), "x");
  await writeFile(join(dir, "agent.log"), "x");

  await downgradeWorktree(dir, "artifact-only", "metadata-only");

  const remaining = await readdir(dir);
  expect(remaining).not.toContain("target");
  expect(remaining).toContain("task.json");
  expect(remaining).toContain("result.json");
  expect(remaining).toContain("agent.log");
});
