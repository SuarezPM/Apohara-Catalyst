import { describe, test, expect, beforeEach } from "bun:test";
import { snapshotProtectedPaths, detectViolations } from "../../../../src/core/safety/runnerPolicy/fsSnapshot";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { Glob } from "bun";

describe("fsSnapshot", () => {
  const tmp = join("/tmp", "apohara-fs-snapshot-test-" + Date.now());

  beforeEach(async () => {
    await mkdir(join(tmp, ".apohara"), { recursive: true });
    await writeFile(join(tmp, "AGENTS.md"), "# Agents config");
    await writeFile(join(tmp, "CLAUDE.md"), "# Claude config");
    await writeFile(join(tmp, ".env"), "SECRET=xyz");
  });

  test("snapshot empty workspace returns empty files", async () => {
    const emptyDir = join(tmp, "empty");
    await mkdir(emptyDir, { recursive: true });
    const result = await snapshotProtectedPaths(emptyDir, ["**/*.none"]);
    expect(result.files).toHaveLength(0);
  });

  test("snapshot reads file content + computes sha256", async () => {
    const result = await snapshotProtectedPaths(tmp, ["AGENTS.md", "CLAUDE.md", ".env*"]);
    expect(result.files.length).toBeGreaterThan(0);
    for (const f of result.files) {
      expect(f.sha256).toHaveLength(64);
      expect(f.size).toBeGreaterThan(0);
    }
  });

  test("detectViolations finds modified file", async () => {
    const before = await snapshotProtectedPaths(tmp, ["AGENTS.md"]);
    expect(before.files.length).toBe(1);

    await writeFile(join(tmp, "AGENTS.md"), "modified content");

    const violations = await detectViolations(before, tmp);
    expect(violations).toHaveLength(1);
    expect(violations[0].path).toBe("AGENTS.md");
    expect(violations[0].before).not.toBe(violations[0].after);

    await rm(tmp, { recursive: true, force: true });
  });
});