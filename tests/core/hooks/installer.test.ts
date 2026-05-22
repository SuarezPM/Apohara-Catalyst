import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, readFile, writeFile, rm, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installHook, computeHookHash } from "../../../src/core/hooks/installer";

let workDir: string;
beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "apohara-installer-"));
});
afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

test("installHook writes the script to the target path", async () => {
  const target = join(workDir, "apohara-claude-hook.sh");
  const script = "#!/bin/bash\necho test\n";
  await installHook(target, script);
  const content = await readFile(target, "utf-8");
  expect(content).toBe(script);
});

test("installHook is idempotent (re-install of same content is no-op)", async () => {
  const target = join(workDir, "apohara-claude-hook.sh");
  const script = "#!/bin/bash\necho v1\n";
  await installHook(target, script);
  const stat1 = await stat(target);
  await new Promise(r => setTimeout(r, 20));
  await installHook(target, script);
  const stat2 = await stat(target);
  expect(stat2.mtimeMs).toBe(stat1.mtimeMs);
});

test("installHook backs up existing file when content differs", async () => {
  const target = join(workDir, "apohara-claude-hook.sh");
  await writeFile(target, "#!/bin/bash\necho v1\n");
  await installHook(target, "#!/bin/bash\necho v2\n");
  const content = await readFile(target, "utf-8");
  expect(content).toBe("#!/bin/bash\necho v2\n");
  const files = await readdir(workDir);
  expect(files.filter(f => f.includes(".bak."))).toHaveLength(1);
});

test("computeHookHash returns deterministic sha256", () => {
  const a = computeHookHash("hello");
  const b = computeHookHash("hello");
  const c = computeHookHash("world");
  expect(a).toBe(b);
  expect(a).not.toBe(c);
  expect(a).toMatch(/^[0-9a-f]{64}$/);
});