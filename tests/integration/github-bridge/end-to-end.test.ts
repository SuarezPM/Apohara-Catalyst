/**
 * End-to-end integration test for the github-bridge per spec §9.8.
 *
 * Wires the poller → issue parser → PR builder against in-memory stubs of
 * the Octokit-backed interfaces (IssueSource, PRRepo). Asserts the full
 * happy path (issue → task → PR), idempotency (same attemptKey reuses an
 * open PR), the already-processed guard (messages table is the source of
 * truth), the ambiguous path (comment + needs-input label), and the
 * INV-15 reporting toggle in the PR body.
 *
 * Notes on API surface vs. the task brief:
 *   - parseIssue returns kind: "objective" (not "ok") — assertions adapt.
 *   - openOrchestrationDb is async and takes a path; we use a temp dir
 *     to mirror the existing poller.test.ts pattern (bun:sqlite ":memory:"
 *     would also work but tmp file matches how every sibling test runs).
 */
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openOrchestrationDb, type OrchestrationDb } from "../../../src/core/orchestration/db.js";
import {
  pollOnce,
  type IssueSource,
  type IssueSummary,
} from "../../../packages/github-bridge/src/poller.js";
import {
  buildPRBody,
  computeIdempotencyKey,
  createOrUpdatePR,
  type PRBuildInput,
  type PRRepo,
  type ExistingPR,
} from "../../../packages/github-bridge/src/pr-builder.js";

// ---------- Stubs ----------

class StubIssueSource implements IssueSource {
  constructor(public issues: IssueSummary[] = []) {}
  comments: { issueNumber: number; body: string }[] = [];
  labels: { issueNumber: number; label: string }[] = [];

  async listOpenLabeled(_label: string) {
    return this.issues;
  }
  async postComment(issueNumber: number, body: string) {
    this.comments.push({ issueNumber, body });
  }
  async addLabel(issueNumber: number, label: string) {
    this.labels.push({ issueNumber, label });
  }
}

class StubPRRepo implements PRRepo {
  prs: ExistingPR[] = [];
  listCalls: { state?: string; head?: string }[] = [];
  created: { title: string; body: string; head: string; base: string }[] = [];
  updated: { number: number; body: string }[] = [];

  async listPRs(
    _repo: { owner: string; repo: string },
    params: { state?: "open" | "closed" | "all"; head?: string } = {},
  ) {
    this.listCalls.push({ state: params.state, head: params.head });
    if (params.head) {
      return this.prs.filter((p) => p.head === params.head);
    }
    return this.prs;
  }

  async createPR(
    _repo: { owner: string; repo: string },
    p: { title: string; body: string; head: string; base: string },
  ) {
    this.created.push(p);
    const number = 200 + this.created.length;
    // Auto-track the freshly created PR so subsequent idempotent calls
    // see it as "existing" without test-side bookkeeping.
    this.prs.push({
      number,
      state: "open",
      merged: false,
      body: p.body,
      head: p.head,
    });
    return { number, html_url: `https://github.com/SuarezPM/Apohara/pull/${number}` };
  }

  async updatePR(
    _repo: { owner: string; repo: string },
    prNumber: number,
    p: { body: string },
  ) {
    this.updated.push({ number: prNumber, body: p.body });
    const pr = this.prs.find((x) => x.number === prNumber);
    if (pr) pr.body = p.body;
  }
}

function makePRInput(over: Partial<PRBuildInput> = {}): PRBuildInput {
  return {
    owner: "SuarezPM",
    repo: "Apohara",
    issueNumber: 42,
    runId: "r-e2e-1",
    headBranch: "apohara/e2e-feature",
    baseBranch: "main",
    title: "Apohara: e2e test PR",
    changesSummary: "Wired poller + parser + PR builder end-to-end.",
    agents: [{ id: "agent:claude:t1", role: "coder" }],
    verificationVerdict: { judge: 0.9, critic: 0.85, invariantsOk: true },
    attemptKey: "task-42#attempt-1",
    ...over,
  };
}

const HAPPY_BODY = [
  "---",
  "priority: high",
  "---",
  "",
  "## Objective",
  "Fix the broken login flow on the desktop UI.",
  "",
  "## Acceptance Criteria",
  "- [ ] Login screen accepts valid creds",
  "- [ ] Tests pass",
].join("\n");

// ---------- Fixtures ----------

let workDir: string;
let db: OrchestrationDb;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "apohara-e2e-"));
  db = await openOrchestrationDb(join(workDir, "o.db"));
});
afterEach(async () => {
  db.close();
  await rm(workDir, { recursive: true, force: true });
});

// ---------- Tests ----------

test("happy path: poller inserts task; PR builder creates PR with marker + run id + INV-15", async () => {
  const source = new StubIssueSource([
    { number: 42, title: "Fix login", body: HAPPY_BODY, labels: ["apohara"] },
  ]);

  const r = await pollOnce({ db, source, repoLabel: "apohara" });

  expect(r.newTasks).toBe(1);
  expect(r.ambiguous).toBe(0);
  expect(r.alreadyProcessed).toBe(0);

  // task persisted
  const tasksRows = db.raw().query("SELECT id, spec, status FROM tasks").all() as {
    id: string;
    spec: string;
    status: string;
  }[];
  expect(tasksRows.length).toBe(1);
  expect(tasksRows[0].status).toBe("pending");
  const spec = JSON.parse(tasksRows[0].spec);
  expect(spec.description).toContain("Fix the broken login");

  // poller wrote @github → @coordinator dispatch message (this is the
  // already-processed guard's lookup key)
  const msgs = db.raw().query("SELECT from_handle, thread_id FROM messages").all() as {
    from_handle: string;
    thread_id: string;
  }[];
  expect(msgs.length).toBe(1);
  expect(msgs[0].from_handle).toBe("@github");
  expect(msgs[0].thread_id).toBe("issue-42");

  // poller added in-progress label
  expect(source.labels.some((l) => l.label === "apohara-in-progress")).toBe(true);

  // now wire the PR builder
  const prRepo = new StubPRRepo();
  const result = await createOrUpdatePR(prRepo, makePRInput());

  expect(result.action).toBe("created");
  expect(result.prNumber).toBeGreaterThan(0);
  expect(prRepo.created.length).toBe(1);

  const created = prRepo.created[0]!;
  const expectedKey = computeIdempotencyKey("task-42#attempt-1");
  expect(created.body).toContain(`<!-- apohara-attempt: sha256:${expectedKey} -->`);
  expect(created.body).toContain("r-e2e-1");
  expect(created.body).toContain("INV-15");
  expect(created.body).toContain("Closes #42");
});

test("idempotency: re-running PR builder with same attemptKey updates existing open PR", async () => {
  const prRepo = new StubPRRepo();

  // first call creates the PR
  const first = await createOrUpdatePR(prRepo, makePRInput());
  expect(first.action).toBe("created");
  expect(prRepo.created.length).toBe(1);
  expect(prRepo.updated.length).toBe(0);
  const firstNumber = first.prNumber;

  // second call with the same attemptKey should match via the
  // idempotency marker (the stub auto-seeds prs[] in createPR) and update
  const second = await createOrUpdatePR(
    prRepo,
    makePRInput({ changesSummary: "Refined fix after critic feedback." }),
  );
  expect(second.action).toBe("updated");
  expect(second.prNumber).toBe(firstNumber);
  expect(prRepo.created.length).toBe(1);
  expect(prRepo.updated.length).toBe(1);
  expect(prRepo.updated[0].body).toContain("Refined fix after critic feedback.");
  expect(prRepo.updated[0].body).toContain(
    `<!-- apohara-attempt: sha256:${computeIdempotencyKey("task-42#attempt-1")} -->`,
  );
});

test("idempotency (explicit seed): pre-seeded PR with marker is reused on subsequent createOrUpdatePR", async () => {
  // Mirror the brief's explicit scenario: PR pre-exists with the marker
  // baked in. Use a fresh repo (no createPR side-effect seeding).
  const prRepo = new StubPRRepo();
  const key = computeIdempotencyKey("task-42#attempt-1");
  prRepo.prs.push({
    number: 555,
    state: "open",
    merged: false,
    body: `<!-- apohara-attempt: sha256:${key} -->\n\nstale body`,
    head: "some-other-branch",
  });

  const r = await createOrUpdatePR(prRepo, makePRInput());
  expect(r.action).toBe("updated");
  expect(r.prNumber).toBe(555);
  expect(prRepo.updated.length).toBe(1);
  expect(prRepo.updated[0].number).toBe(555);
  expect(prRepo.created.length).toBe(0);
});

test("already-processed issue: second poll with the same issue is skipped", async () => {
  const source = new StubIssueSource([
    { number: 42, title: "Fix login", body: HAPPY_BODY, labels: ["apohara"] },
  ]);

  const r1 = await pollOnce({ db, source, repoLabel: "apohara" });
  expect(r1.newTasks).toBe(1);
  expect(r1.alreadyProcessed).toBe(0);

  // reset side-effect logs but leave issues[] intact
  source.comments = [];
  source.labels = [];

  const r2 = await pollOnce({ db, source, repoLabel: "apohara" });
  expect(r2.alreadyProcessed).toBe(1);
  expect(r2.newTasks).toBe(0);
  expect(r2.ambiguous).toBe(0);

  // no fresh side-effects on the source
  expect(source.comments.length).toBe(0);
  expect(source.labels.length).toBe(0);

  // and only one row in tasks (no duplicate insert)
  const taskCount = (
    db.raw().query("SELECT COUNT(*) as n FROM tasks").get() as { n: number }
  ).n;
  expect(taskCount).toBe(1);
});

test("ambiguous issue: poller posts clarification comment + apohara-needs-input label", async () => {
  const source = new StubIssueSource([
    { number: 99, title: "vague", body: "fix it", labels: ["apohara"] },
  ]);
  // Note: "fix it" is a plain-body parse → first paragraph becomes
  // objective ("fix it"), which the parser treats as valid. The truly
  // ambiguous shape is empty body or frontmatter-without-objective.
  // Use a frontmatter-only body (no ## Objective) to force ambiguous.
  source.issues[0]!.body = "---\npriority: high\n---\n\nNo objective section here.";

  const r = await pollOnce({ db, source, repoLabel: "apohara" });
  expect(r.ambiguous).toBeGreaterThanOrEqual(1);
  expect(r.newTasks).toBe(0);

  // comment posted
  expect(source.comments.length).toBe(1);
  expect(source.comments[0].issueNumber).toBe(99);
  expect(source.comments[0].body.toLowerCase()).toContain("clarification");

  // needs-input label applied
  expect(source.labels.some((l) => l.label === "apohara-needs-input")).toBe(true);

  // and in-progress label NOT applied
  expect(source.labels.some((l) => l.label === "apohara-in-progress")).toBe(false);

  // poller did NOT insert a task and did NOT write an @github dispatch
  // message (the already-processed guard keys on it, so leaving it absent
  // is what lets the user retry after editing the issue)
  const taskCount = (
    db.raw().query("SELECT COUNT(*) as n FROM tasks").get() as { n: number }
  ).n;
  expect(taskCount).toBe(0);
  const msgCount = (
    db
      .raw()
      .query("SELECT COUNT(*) as n FROM messages WHERE from_handle = '@github'")
      .get() as { n: number }
  ).n;
  expect(msgCount).toBe(0);
});

test("PR body INV-15 reporting toggles between FAILED and OK", async () => {
  const failed = buildPRBody(
    makePRInput({ verificationVerdict: { invariantsOk: false } }),
  );
  expect(failed).toContain("INV-15");
  expect(failed).toContain("FAILED");
  expect(failed).not.toMatch(/INV-15[^\n]*OK/);

  const ok = buildPRBody(
    makePRInput({
      verificationVerdict: { judge: 1, critic: 1, invariantsOk: true },
    }),
  );
  expect(ok).toContain("INV-15");
  expect(ok).toMatch(/INV-15[^\n]*OK/);
  expect(ok).not.toContain("FAILED");
});

test("end-to-end chain: happy issue → task → PR built from same attemptKey reuses on rebuild", async () => {
  // Single composite scenario that exercises the full chain in one run.
  const source = new StubIssueSource([
    { number: 77, title: "Real chain", body: HAPPY_BODY, labels: ["apohara"] },
  ]);

  const pollResult = await pollOnce({ db, source, repoLabel: "apohara" });
  expect(pollResult.newTasks).toBe(1);

  // Recover the synthetic task id the poller minted to use as attemptKey
  // (mirrors what the real coordinator will do downstream).
  const taskRow = db.raw().query("SELECT id FROM tasks LIMIT 1").get() as { id: string };
  expect(taskRow.id).toMatch(/^gh-77-/);

  const attemptKey = `${taskRow.id}#attempt-1`;
  const prInput = makePRInput({
    issueNumber: 77,
    attemptKey,
    headBranch: "apohara/issue-77",
  });

  const prRepo = new StubPRRepo();
  const first = await createOrUpdatePR(prRepo, prInput);
  expect(first.action).toBe("created");
  expect(first.htmlUrl).toContain("/pull/");

  // Rebuild with the same attemptKey → idempotent update, not a duplicate
  const second = await createOrUpdatePR(prRepo, prInput);
  expect(second.action).toBe("updated");
  expect(second.prNumber).toBe(first.prNumber);
  expect(prRepo.created.length).toBe(1);
});
