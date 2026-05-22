import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePlanDocument, type PlanDocument, type ChecklistItem } from "../../../src/core/spec/planDocuments";

let workDir: string;
beforeEach(async () => { workDir = await mkdtemp(join(tmpdir(), "apohara-plan-")); });
afterEach(async () => { await rm(workDir, { recursive: true, force: true }); });

test("parses well-formed plan with frontmatter + sections", async () => {
  const path = join(workDir, "plan.md");
  await writeFile(path, [
    "---",
    "title: Test Plan",
    "status: active",
    "planType: feature",
    "priority: high",
    "owner: alice",
    "tags: [auth, api]",
    "progress: 25",
    "---",
    "",
    "## Objective",
    "Build the JWT helper.",
    "",
    "## Acceptance Criteria",
    "- [ ] Token signs with HS256",
    "- [x] Refresh endpoint exists",
    "- [ ] Tests cover edge cases",
    "",
    "## Out of Scope",
    "- Mobile app integration",
    "",
    "## Context",
    "Replaces the old session cookie auth.",
    "",
  ].join("\n"));

  const plan = await parsePlanDocument(path);
  expect(plan.title).toBe("Test Plan");
  expect(plan.status).toBe("active");
  expect(plan.planType).toBe("feature");
  expect(plan.priority).toBe("high");
  expect(plan.owner).toBe("alice");
  expect(plan.tags).toEqual(["auth", "api"]);
  expect(plan.progress).toBe(25);
  expect(plan.objective).toContain("JWT helper");
  expect(plan.acceptanceCriteria.length).toBe(3);
  expect(plan.acceptanceCriteria[0]).toEqual({ checked: false, text: "Token signs with HS256" });
  expect(plan.acceptanceCriteria[1]).toEqual({ checked: true, text: "Refresh endpoint exists" });
  expect(plan.outOfScope).toEqual(["Mobile app integration"]);
  expect(plan.context).toContain("session cookie");
  expect(plan.planId).toMatch(/^[0-9a-f]{40}$/);  // sha1 hex
  expect(plan.agentSessions).toEqual([]);
});

test("rejects missing frontmatter", async () => {
  const path = join(workDir, "no-frontmatter.md");
  await writeFile(path, "## Objective\nGo go go.\n");
  await expect(parsePlanDocument(path)).rejects.toThrow(/frontmatter/i);
});

test("rejects malformed YAML in frontmatter", async () => {
  const path = join(workDir, "bad.md");
  await writeFile(path, "---\ntitle: : :\nstatus active\n---\n## Objective\nx\n");
  await expect(parsePlanDocument(path)).rejects.toThrow();
});

test("rejects missing title in frontmatter", async () => {
  const path = join(workDir, "no-title.md");
  await writeFile(path, "---\nstatus: draft\n---\n## Objective\nx\n");
  await expect(parsePlanDocument(path)).rejects.toThrow(/title/i);
});

test("rejects invalid status enum", async () => {
  const path = join(workDir, "bad-status.md");
  await writeFile(path, "---\ntitle: T\nstatus: wibble\n---\n## Objective\nx\n");
  await expect(parsePlanDocument(path)).rejects.toThrow(/status/i);
});

test("parses minimal plan (only required fields)", async () => {
  const path = join(workDir, "minimal.md");
  await writeFile(path, "---\ntitle: Min\nstatus: draft\n---\n## Objective\nDo less.\n");
  const plan = await parsePlanDocument(path);
  expect(plan.title).toBe("Min");
  expect(plan.status).toBe("draft");
  expect(plan.objective).toContain("Do less");
  expect(plan.acceptanceCriteria).toEqual([]);
  expect(plan.planType).toBeUndefined();
});

test("planId is deterministic (same file + frontmatter → same id)", async () => {
  const path = join(workDir, "stable.md");
  await writeFile(path, "---\ntitle: Stable\nstatus: draft\n---\n## Objective\nx\n");
  const p1 = await parsePlanDocument(path);
  const p2 = await parsePlanDocument(path);
  expect(p1.planId).toBe(p2.planId);
});
