/**
 * G5.A.5 — file snapshot before/after (nimbalyst #1.5).
 *
 * snapshotDir(path) walks the workspace and records each file's
 * (path, sha256, size). diffSnapshots(a, b) returns sets of added /
 * modified / deleted paths so the UI can show "what changed during this
 * agent turn". Used by verification + plans page.
 */
import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, unlinkSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  snapshotDir,
  diffSnapshots,
} from "../../../src/core/providers/file-snapshot";

test("snapshotDir captures all files with sha256", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fs-snap-"));
  writeFileSync(join(dir, "a.txt"), "hello");
  mkdirSync(join(dir, "sub"));
  writeFileSync(join(dir, "sub", "b.txt"), "world");

  const snap = await snapshotDir(dir);
  const files = Object.keys(snap.files).sort();
  expect(files).toEqual(["a.txt", "sub/b.txt"]);
  expect(snap.files["a.txt"]?.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(snap.files["a.txt"]?.size).toBe(5);
  rmSync(dir, { recursive: true });
});

test("diffSnapshots: detects added / modified / deleted", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fs-snap-"));
  writeFileSync(join(dir, "keep.txt"), "same");
  writeFileSync(join(dir, "modify.txt"), "original");
  writeFileSync(join(dir, "remove.txt"), "doomed");
  const before = await snapshotDir(dir);

  writeFileSync(join(dir, "modify.txt"), "changed");
  unlinkSync(join(dir, "remove.txt"));
  writeFileSync(join(dir, "added.txt"), "new");
  const after = await snapshotDir(dir);

  const diff = diffSnapshots(before, after);
  expect(diff.added).toEqual(["added.txt"]);
  expect(diff.modified).toEqual(["modify.txt"]);
  expect(diff.deleted).toEqual(["remove.txt"]);
  rmSync(dir, { recursive: true });
});

test("snapshotDir: respects skip patterns (node_modules, .git)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fs-snap-"));
  mkdirSync(join(dir, "node_modules", "foo"), { recursive: true });
  writeFileSync(join(dir, "node_modules", "foo", "x.js"), "y");
  mkdirSync(join(dir, ".git"), { recursive: true });
  writeFileSync(join(dir, ".git", "HEAD"), "ref");
  writeFileSync(join(dir, "src.ts"), "let x = 1;");
  const snap = await snapshotDir(dir);
  const files = Object.keys(snap.files);
  expect(files).toEqual(["src.ts"]);
  rmSync(dir, { recursive: true });
});

test("diffSnapshots: identical snapshots produce empty diff", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fs-snap-"));
  writeFileSync(join(dir, "x.txt"), "abc");
  const a = await snapshotDir(dir);
  const b = await snapshotDir(dir);
  const d = diffSnapshots(a, b);
  expect(d.added.length).toBe(0);
  expect(d.modified.length).toBe(0);
  expect(d.deleted.length).toBe(0);
  rmSync(dir, { recursive: true });
});
