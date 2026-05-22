import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, readFile, unlink, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atomicWriteFile } from "../../../src/core/persistence/atomicWrite";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "apohara-atomic-"));
});
afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

test("atomicWriteFile writes content to target path", async () => {
  const target = join(workDir, "config.yaml");
  await atomicWriteFile(target, "key: value\n");
  const content = await readFile(target, "utf-8");
  expect(content).toBe("key: value\n");
});

test("atomicWriteFile does not leave tmp files behind on success", async () => {
  const target = join(workDir, "config.yaml");
  await atomicWriteFile(target, "ok");
  const { readdir } = await import("node:fs/promises");
  const files = await readdir(workDir);
  expect(files).toEqual(["config.yaml"]);
});

test("atomicWriteFile cleans up tmp on write failure", async () => {
  const target = join(workDir, "subdir/does/not/exist/config.yaml");
  await expect(atomicWriteFile(target, "ok")).rejects.toThrow();
  const { readdir } = await import("node:fs/promises");
  const files = await readdir(workDir).catch(() => []);
  expect(files.filter(f => f.startsWith(".tmp."))).toEqual([]);
});

test("atomicWriteFile overwrites existing file atomically", async () => {
  const target = join(workDir, "config.yaml");
  await atomicWriteFile(target, "v1");
  await atomicWriteFile(target, "v2");
  const content = await readFile(target, "utf-8");
  expect(content).toBe("v2");
});
