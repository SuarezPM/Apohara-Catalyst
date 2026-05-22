import { test, expect } from "bun:test";
import { parseIssue } from "../../../packages/github-bridge/src/issue-parser.js";

test("parses issue with frontmatter + Objective section", () => {
  const body = [
    "---",
    "priority: high",
    "---",
    "",
    "## Objective",
    "Fix the broken login.",
    "",
    "## Acceptance Criteria",
    "- [ ] Tests pass",
    "- [x] Done",
  ].join("\n");
  const r = parseIssue(body);
  expect(r.kind).toBe("objective");
  if (r.kind === "objective") {
    expect(r.payload.objective).toContain("Fix the broken login");
    expect(r.payload.priority).toBe("high");
    expect(r.payload.acceptanceCriteria.length).toBe(2);
  }
});

test("parses ## SPEC heading style", () => {
  const body = "## SPEC\nBuild a new feature.\n";
  const r = parseIssue(body);
  expect(r.kind).toBe("objective");
});

test("plain body returns first paragraph as objective", () => {
  const body = "Fix the bug in auth.\n\nMore context here.\n\n- [ ] Tests pass";
  const r = parseIssue(body);
  expect(r.kind).toBe("objective");
  if (r.kind === "objective") {
    expect(r.payload.objective).toBe("Fix the bug in auth.");
    expect(r.payload.acceptanceCriteria.length).toBe(1);
  }
});

test("empty body returns ambiguous", () => {
  const r = parseIssue("");
  expect(r.kind).toBe("ambiguous");
});

test("frontmatter without objective returns ambiguous", () => {
  const body = "---\npriority: high\n---\n\nJust some text but no ## Objective section.\n";
  const r = parseIssue(body);
  expect(r.kind).toBe("ambiguous");
});

test("frontmatter with invalid priority ignored", () => {
  const body = "---\npriority: weird\n---\n\n## Objective\nDo it.\n";
  const r = parseIssue(body);
  expect(r.kind).toBe("objective");
  if (r.kind === "objective") {
    expect(r.payload.priority).toBeUndefined();
  }
});