import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAutoCommand, type AutoResult } from "../../src/cli/auto";

let workDir: string;
beforeEach(async () => { workDir = await mkdtemp(join(tmpdir(), "apohara-auto-")); });
afterEach(async () => { await rm(workDir, { recursive: true, force: true }); });

test("loads active plan and returns ObjectivePayload", async () => {
  const path = join(workDir, "plan.md");
  await writeFile(path, [
    "---",
    "title: Active Plan",
    "status: active",
    "---",
    "## Objective",
    "Build the feature.",
    "",
    "## Acceptance Criteria",
    "- [ ] Tests pass",
    "- [ ] Docs updated",
    "",
  ].join("\n"));

  const result = await runAutoCommand({ specPath: path });
  expect(result.exitCode).toBe(0);
  expect(result.payload).toBeDefined();
  expect(result.payload?.planId).toBeDefined();
  expect(result.payload?.title).toBe("Active Plan");
  expect(result.payload?.objective).toContain("Build the feature");
  expect(result.payload?.acceptanceCriteria.length).toBe(2);
});

test("rejects paused plan with SPEC_PAUSED error", async () => {
  const path = join(workDir, "paused.md");
  await writeFile(path, [
    "---",
    "title: Paused",
    "status: paused",
    "---",
    "## Objective",
    "Wait.",
    "",
  ].join("\n"));

  const result = await runAutoCommand({ specPath: path });
  expect(result.exitCode).not.toBe(0);
  expect(result.error).toBeDefined();
  expect(result.error?.code).toBe("SPEC_PAUSED");
});

test("rejects missing spec file", async () => {
  const result = await runAutoCommand({ specPath: join(workDir, "nonexistent.md") });
  expect(result.exitCode).not.toBe(0);
  expect(result.error).toBeDefined();
});

test("appends agent session ref to plan via managed block", async () => {
  const path = join(workDir, "plan.md");
  await writeFile(path, [
    "---",
    "title: Track",
    "status: active",
    "---",
    "## Objective",
    "Track me.",
    "",
  ].join("\n"));

  const result = await runAutoCommand({
    specPath: path,
    appendSession: { sessionId: "s-1", startedAt: 1700000000000 },
  });
  expect(result.exitCode).toBe(0);

  const updated = await Bun.file(path).text();
  expect(updated).toContain("<!-- apohara:agentSessions:start -->");
  expect(updated).toContain("<!-- apohara:agentSessions:end -->");
  expect(updated).toContain("s-1");
});