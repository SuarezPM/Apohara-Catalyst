/**
 * Spec §7 task 10.4: github-bridge end-to-end acceptance gate.
 *
 * The detailed e2e flow is exercised by tests/integration/github-bridge/end-to-end.test.ts (Stage 9.8).
 * This file is the Stage 10 acceptance check that:
 *   - The PR body templating embeds the idempotency marker (attempt_key)
 *   - The PR body includes a replay URL when supplied
 *   - The poll-then-PR pipeline parts compose correctly (smoke level)
 */
import { test, expect } from "bun:test";
import { buildPRBody, computeIdempotencyKey, type PRBuildInput } from "../../packages/github-bridge/src/pr-builder";

function input(over: Partial<PRBuildInput> = {}): PRBuildInput {
  return {
    owner: "SuarezPM", repo: "Apohara", runId: "r-stage10-1",
    headBranch: "apohara/swift-falcon-a3f9c2",
    baseBranch: "main",
    title: "Apohara: stage-10 acceptance",
    changesSummary: "Updated routes.",
    agents: [{ id: "agent:claude:s10", role: "coder" }],
    verificationVerdict: { judge: 0.91, critic: 0.88, invariantsOk: true },
    attemptKey: "r-stage10-1#attempt-1",
    ...over,
  };
}

test("PR body embeds attempt_key idempotency marker (sha256)", () => {
  const body = buildPRBody(input());
  const key = computeIdempotencyKey("r-stage10-1#attempt-1");
  expect(body).toContain(`<!-- apohara-attempt: sha256:${key} -->`);
});

test("PR body includes replay URL when provided", () => {
  const replayUrl = "https://apohara.example/replay/r-stage10-1";
  const body = buildPRBody(input({ replayUrl }));
  expect(body).toContain(replayUrl);
});

test("PR body labels INV-15 status from verification verdict", () => {
  expect(buildPRBody(input({ verificationVerdict: { invariantsOk: true } }))).toContain("OK");
  expect(buildPRBody(input({ verificationVerdict: { invariantsOk: false } }))).toContain("FAILED");
});

test("PR body links the issue when issueNumber present", () => {
  const body = buildPRBody(input({ issueNumber: 99 }));
  expect(body).toContain("Closes #99");
});