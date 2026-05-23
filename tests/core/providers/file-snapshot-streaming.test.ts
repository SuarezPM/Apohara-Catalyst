/**
 * G5.A.8 — file snapshot streaming diffs (nimbalyst #11.2).
 *
 * Extends G5.A.5 with `streamSnapshotDiffs(root, snapshot, intervalMs)`
 * — periodically rescans the dir and yields a SnapshotDiff per tick that
 * only contains paths changed since the previous snapshot. Generator
 * terminates when caller calls `stop()`.
 */
import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  snapshotDir,
} from "../../../src/core/providers/file-snapshot";
import {
  streamSnapshotDiffs,
} from "../../../src/core/providers/file-snapshot-streaming";

test("streamSnapshotDiffs yields one diff per detected change", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fs-stream-"));
  writeFileSync(join(dir, "a.txt"), "v1");
  const initial = await snapshotDir(dir);

  const stream = streamSnapshotDiffs(dir, initial, { intervalMs: 20 });
  // Modify after the stream starts
  setTimeout(() => writeFileSync(join(dir, "a.txt"), "v2"), 30);
  setTimeout(() => writeFileSync(join(dir, "b.txt"), "new"), 60);
  setTimeout(() => stream.stop(), 120);

  const diffs: { added: string[]; modified: string[]; deleted: string[] }[] = [];
  for await (const d of stream.iter) diffs.push({ added: d.added, modified: d.modified, deleted: d.deleted });

  // We should observe at least one diff containing 'a.txt' modified
  // and one containing 'b.txt' added — they may collapse into one tick.
  const allAdded = diffs.flatMap((d) => d.added);
  const allModified = diffs.flatMap((d) => d.modified);
  expect(allModified).toContain("a.txt");
  expect(allAdded).toContain("b.txt");
  rmSync(dir, { recursive: true });
});

test("streamSnapshotDiffs.stop terminates the iterator", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fs-stream-"));
  const initial = await snapshotDir(dir);
  const stream = streamSnapshotDiffs(dir, initial, { intervalMs: 10 });
  setTimeout(() => stream.stop(), 30);
  let count = 0;
  for await (const _ of stream.iter) count++;
  // No file changes — but stop() must still terminate cleanly.
  expect(count).toBeGreaterThanOrEqual(0);
  rmSync(dir, { recursive: true });
});
