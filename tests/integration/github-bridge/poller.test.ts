import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openOrchestrationDb, type OrchestrationDb } from "../../../src/core/orchestration/db.js";
import { pollOnce, type IssueSource, type IssueSummary } from "../../../packages/github-bridge/src/poller.js";

class StubSource implements IssueSource {
  constructor(public issues: IssueSummary[] = []) {}
  comments: { issueNumber: number; body: string }[] = [];
  labels: { issueNumber: number; label: string }[] = [];

  async listOpenLabeled(_label: string) { return this.issues; }
  async postComment(issueNumber: number, body: string) { this.comments.push({ issueNumber, body }); }
  async addLabel(issueNumber: number, label: string) { this.labels.push({ issueNumber, label }); }
}

let workDir: string;
let db: OrchestrationDb;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "apohara-poller-"));
  db = await openOrchestrationDb(join(workDir, "o.db"));
});
afterEach(async () => {
  db.close();
  await rm(workDir, { recursive: true, force: true });
});

test("structured issue → insertTask + apohara-in-progress label", async () => {
  const source = new StubSource([{
    number: 42,
    title: "Fix login",
    body: "## Objective\nFix the broken login.\n\n## Acceptance Criteria\n- [ ] Tests pass\n",
    labels: ["apohara"],
  }]);
  const r = await pollOnce({ db, source });
  expect(r.newTasks).toBe(1);
  expect(source.labels.find(l => l.label === "apohara-in-progress")).toBeDefined();
});

test("ambiguous issue → postComment + apohara-needs-input label", async () => {
  const source = new StubSource([{
    number: 99, title: "?", body: "", labels: ["apohara"],
  }]);
  const r = await pollOnce({ db, source });
  expect(r.ambiguous).toBe(1);
  expect(source.comments.length).toBe(1);
  expect(source.labels.find(l => l.label === "apohara-needs-input")).toBeDefined();
});

test("already-processed issue is skipped on second poll", async () => {
  const source = new StubSource([{
    number: 7, title: "Once", body: "## Objective\nDo it.\n", labels: ["apohara"],
  }]);
  await pollOnce({ db, source });
  source.labels = [];
  source.comments = [];
  const r2 = await pollOnce({ db, source });
  expect(r2.alreadyProcessed).toBe(1);
  expect(r2.newTasks).toBe(0);
});

test("plain body (first paragraph) → task", async () => {
  const source = new StubSource([{
    number: 5, title: "Plain", body: "Build the new endpoint.\n\nMore details here.",
    labels: ["apohara"],
  }]);
  const r = await pollOnce({ db, source });
  expect(r.newTasks).toBe(1);
});

test("multiple issues processed in one poll", async () => {
  const source = new StubSource([
    { number: 1, title: "A", body: "## Objective\nA\n", labels: ["apohara"] },
    { number: 2, title: "B", body: "", labels: ["apohara"] },
    { number: 3, title: "C", body: "## Objective\nC\n", labels: ["apohara"] },
  ]);
  const r = await pollOnce({ db, source });
  expect(r.newTasks).toBe(2);
  expect(r.ambiguous).toBe(1);
});