import { test, expect } from "bun:test";
import { buildPRBody, computeIdempotencyKey, createOrUpdatePR, type PRBuildInput, type PRRepo, type ExistingPR } from "../../../packages/github-bridge/src/pr-builder.js";

function input(over: Partial<PRBuildInput> = {}): PRBuildInput {
  return {
    owner: "SuarezPM", repo: "Apohara", runId: "r-1",
    headBranch: "apohara/swift-falcon-a3f9c2",
    baseBranch: "main",
    title: "Apohara: fix login bug",
    changesSummary: "Updated jwt.ts to use HS256.",
    agents: [{ id: "agent:claude:t1", role: "coder" }],
    verificationVerdict: { judge: 0.9, critic: 0.85, invariantsOk: true },
    attemptKey: "run-1#attempt-1",
    ...over,
  };
}

class StubRepo implements PRRepo {
  prs: ExistingPR[] = [];
  created: { title: string; body: string; head: string; base: string }[] = [];
  updated: { number: number; body: string }[] = [];

  async listPRs(_repo: { owner: string; repo: string }) { return this.prs; }
  async createPR(_repo: { owner: string; repo: string }, p: { title: string; body: string; head: string; base: string }) {
    this.created.push(p);
    return { number: 100 + this.created.length, html_url: `https://github.com/x/y/pull/${100 + this.created.length}` };
  }
  async updatePR(_repo: { owner: string; repo: string }, prNumber: number, p: { body: string }) {
    this.updated.push({ number: prNumber, body: p.body });
  }
}

test("buildPRBody embeds idempotency marker", () => {
  const body = buildPRBody(input());
  const key = computeIdempotencyKey("run-1#attempt-1");
  expect(body).toContain(`<!-- apohara-attempt: sha256:${key} -->`);
});

test("buildPRBody includes Run ID + INV-15 status", () => {
  const body = buildPRBody(input({ verificationVerdict: { invariantsOk: false } }));
  expect(body).toContain("r-1");
  expect(body).toContain("INV-15");
  expect(body).toContain("FAILED");
});

test("buildPRBody includes Closes #N when issueNumber given", () => {
  const body = buildPRBody(input({ issueNumber: 42 }));
  expect(body).toContain("Closes #42");
});

test("createOrUpdatePR creates new when no match", async () => {
  const repo = new StubRepo();
  const r = await createOrUpdatePR(repo, input());
  expect(r.action).toBe("created");
  expect(repo.created.length).toBe(1);
});

test("createOrUpdatePR updates existing open PR with matching idempotency key", async () => {
  const repo = new StubRepo();
  const key = computeIdempotencyKey("run-1#attempt-1");
  repo.prs.push({
    number: 50,
    state: "open",
    merged: false,
    body: `<!-- apohara-attempt: sha256:${key} -->\nold body`,
    head: "different-branch",
  });
  const r = await createOrUpdatePR(repo, input());
  expect(r.action).toBe("updated");
  expect(r.prNumber).toBe(50);
  expect(repo.updated[0].body).toContain("Updated jwt.ts");
});

test("createOrUpdatePR returns noop for merged PR", async () => {
  const repo = new StubRepo();
  const key = computeIdempotencyKey("run-1#attempt-1");
  repo.prs.push({
    number: 50, state: "closed", merged: true,
    body: `<!-- apohara-attempt: sha256:${key} -->`, head: "x",
  });
  const r = await createOrUpdatePR(repo, input());
  expect(r.action).toBe("noop_merged");
  expect(repo.created.length).toBe(0);
});

test("findPRByHeadBranch fallback when no idempotency match", async () => {
  const repo = new StubRepo();
  repo.prs.push({
    number: 77, state: "open", merged: false,
    body: "no idempotency marker", head: "apohara/swift-falcon-a3f9c2",
  });
  const r = await createOrUpdatePR(repo, input());
  expect(r.action).toBe("updated");
  expect(r.prNumber).toBe(77);
});
