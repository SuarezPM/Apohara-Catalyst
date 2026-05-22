import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "bun";
import { probeWorktreeDrift, shouldRefuseDispatch, DISPATCH_STALE_THRESHOLD } from "../../../src/core/orchestration/drift-probe";

let workDir: string;
async function git(args: string[], cwd: string): Promise<void> {
  const p = spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  await p.exited;
}

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "apohara-drift-"));
});
afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

test("DISPATCH_STALE_THRESHOLD is 20", () => {
  expect(DISPATCH_STALE_THRESHOLD).toBe(20);
});

test("shouldRefuseDispatch refuses when behind >= threshold", () => {
  expect(shouldRefuseDispatch({ commitsBehind: 20, recentSubjects: [] }, { allowStaleBase: false })).toBe(true);
  expect(shouldRefuseDispatch({ commitsBehind: 50, recentSubjects: [] }, { allowStaleBase: false })).toBe(true);
});

test("shouldRefuseDispatch allows when behind < threshold", () => {
  expect(shouldRefuseDispatch({ commitsBehind: 19, recentSubjects: [] }, { allowStaleBase: false })).toBe(false);
  expect(shouldRefuseDispatch({ commitsBehind: 0, recentSubjects: [] }, { allowStaleBase: false })).toBe(false);
});

test("shouldRefuseDispatch allows when allowStaleBase=true regardless", () => {
  expect(shouldRefuseDispatch({ commitsBehind: 100, recentSubjects: [] }, { allowStaleBase: true })).toBe(false);
});

test("probeWorktreeDrift returns 0 commits behind for fresh worktree (no origin)", async () => {
  await git(["init", "--initial-branch=main"], workDir);
  await git(["config", "user.email", "test@test"], workDir);
  await git(["config", "user.name", "test"], workDir);
  await writeFile(join(workDir, "README.md"), "hi\n");
  await git(["add", "."], workDir);
  await git(["commit", "-m", "init"], workDir);

  const drift = await probeWorktreeDrift(workDir, "main");
  expect(drift.commitsBehind).toBe(0);
});