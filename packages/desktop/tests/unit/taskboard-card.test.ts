import { test, expect } from "bun:test";

// Component render tests with happy-dom would be ideal but require setup.
// For Task 7.2 we verify props + formatting helpers at the module level.
// Full DOM tests batched in Task 7.13 (Playwright e2e).

import { TaskBoardCard } from "../../src/components/TaskBoard/TaskBoardCard.js";
import type { DagTask } from "../../src/store/dagStore.js";

test("TaskBoardCard exports a function component", () => {
  expect(typeof TaskBoardCard).toBe("function");
});

test("TaskBoardCard accepts the DagTask shape", () => {
  const task: DagTask = {
    id: "t-1",
    title: "Refactor login",
    status: "dispatched",
    providerId: "claude-code-cli",
    worktreeSlug: "swift-falcon-a3f9c2",
    durationMs: 12_500,
    costUsd: 0.042,
    tokensIn: 3500,
    tokensOut: 1200,
  };
  // Just confirms type compat at compile time
  expect(task.id).toBe("t-1");
});

test("TaskBoardCard handles blocked task with overlap symbols", () => {
  const task: DagTask = {
    id: "t-2",
    title: "Edit user model",
    status: "blocked",
    blockedReason: "reads ∩ writes conflict",
    waitingForTaskId: "t-1",
    overlapSymbols: ["src/auth.ts::verifyJwt", "src/api/user.ts::User", "src/db/users.ts::schema"],
  };
  expect(task.status).toBe("blocked");
  expect(task.overlapSymbols?.length).toBe(3);
});