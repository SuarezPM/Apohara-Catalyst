import { test, expect } from "bun:test";
import { buildDispatchPreamble } from "../../../src/core/orchestration/preamble";

const baseInput = {
  taskId: "task-42",
  dispatchId: 7,
  coordinatorHandle: "@coordinator",
  taskSpec: {
    description: "Refactor login.ts to use JWT helper",
    agentRole: "coder" as const,
    symbols: {
      reads: [{ file: "src/auth/jwt.ts", symbol: "verifyJwt", kind: "function" }],
      writes: [{ file: "src/api/login.ts", symbol: "loginHandler", kind: "function" }],
      renames: [],
    },
  },
};

test("preamble includes task description, role, and symbols", () => {
  const p = buildDispatchPreamble(baseInput);
  expect(p).toContain("task-42");
  expect(p).toContain("Refactor login.ts");
  expect(p).toContain("src/auth/jwt.ts::verifyJwt");
  expect(p).toContain("src/api/login.ts::loginHandler");
});

test("preamble prohibits AskUserQuestion", () => {
  const p = buildDispatchPreamble(baseInput);
  expect(p).toContain("MUST NOT use `AskUserQuestion`");
});

test("preamble includes drift section when baseDrift provided", () => {
  const p = buildDispatchPreamble({
    ...baseInput,
    baseDrift: {
      commitsBehind: 12,
      recentSubjects: ["fix: auth bug", "feat: add metrics", "docs: README"],
    },
  });
  expect(p).toContain("BASE DRIFT WARNING");
  expect(p).toContain("12 commits behind");
  expect(p).toContain("fix: auth bug");
  expect(p).toContain("feat: add metrics");
});

test("preamble omits drift section when baseDrift absent", () => {
  const p = buildDispatchPreamble(baseInput);
  expect(p).not.toContain("BASE DRIFT WARNING");
});

test("preamble includes coordinator handle in send instructions", () => {
  const p = buildDispatchPreamble({ ...baseInput, coordinatorHandle: "@coordinator-prod" });
  expect(p).toContain("@coordinator-prod");
});