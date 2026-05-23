import { expect, test } from "bun:test";
import {
  buildAvailableActions,
  type AvailableAction,
} from "../../../src/core/orchestration/availableActions";
import { buildDispatchPreamble } from "../../../src/core/orchestration/preamble";

test("buildAvailableActions returns enum-shape per task state", () => {
  const actions: AvailableAction[] = buildAvailableActions({
    taskState: "ready",
    hasUncommittedChanges: false,
    workspaceTrust: "trusted",
  });
  expect(actions.map(a => a.label)).toContain("Dispatch");
  const dispatch = actions.find(a => a.label === "Dispatch");
  expect(dispatch?.severity).toBe("normal");
  expect(dispatch?.enabled).toBe(true);
});

test("buildAvailableActions excludes Dispatch when uncommitted changes", () => {
  const actions = buildAvailableActions({
    taskState: "ready",
    hasUncommittedChanges: true,
    workspaceTrust: "trusted",
  });
  const dispatch = actions.find(a => a.label === "Dispatch");
  expect(dispatch?.enabled).toBe(false);
  expect(dispatch?.reason).toMatch(/uncommitted/i);
});

test("buildAvailableActions reports workspace trust gate", () => {
  const actions = buildAvailableActions({
    taskState: "ready",
    hasUncommittedChanges: false,
    workspaceTrust: "untrusted",
  });
  const dispatch = actions.find(a => a.label === "Dispatch");
  expect(dispatch?.enabled).toBe(false);
  expect(dispatch?.reason).toMatch(/untrusted/i);
});

test("Abort only enabled in running state", () => {
  const ready = buildAvailableActions({
    taskState: "ready",
    hasUncommittedChanges: false,
    workspaceTrust: "trusted",
  });
  expect(ready.find(a => a.label === "Abort")?.enabled).toBe(false);

  const running = buildAvailableActions({
    taskState: "running",
    hasUncommittedChanges: false,
    workspaceTrust: "trusted",
  });
  expect(running.find(a => a.label === "Abort")?.enabled).toBe(true);
  expect(running.find(a => a.label === "Abort")?.severity).toBe("destructive");
});

test("Force Re-run is elevated severity and only enabled on terminal states", () => {
  const failed = buildAvailableActions({
    taskState: "failed",
    hasUncommittedChanges: false,
    workspaceTrust: "trusted",
  });
  const force = failed.find(a => a.label === "Force Re-run");
  expect(force?.enabled).toBe(true);
  expect(force?.severity).toBe("elevated");

  const ready = buildAvailableActions({
    taskState: "ready",
    hasUncommittedChanges: false,
    workspaceTrust: "trusted",
  });
  expect(ready.find(a => a.label === "Force Re-run")?.enabled).toBe(false);
});

test("preamble embeds available actions enum when ctx provided", () => {
  const p = buildDispatchPreamble({
    taskId: "task-42",
    dispatchId: 1,
    coordinatorHandle: "@coordinator",
    taskSpec: {
      description: "Test embed",
      agentRole: "coder",
      symbols: { reads: [], writes: [], renames: [] },
    },
    availableActionsContext: {
      taskState: "ready",
      hasUncommittedChanges: false,
      workspaceTrust: "trusted",
    },
  });
  expect(p).toContain("AVAILABLE ACTIONS");
  expect(p).toContain("Dispatch");
  expect(p).toContain('"severity": "normal"');
});

test("preamble omits actions section when context absent (backwards compat)", () => {
  const p = buildDispatchPreamble({
    taskId: "task-42",
    dispatchId: 1,
    coordinatorHandle: "@coordinator",
    taskSpec: {
      description: "No actions",
      agentRole: "coder",
      symbols: { reads: [], writes: [], renames: [] },
    },
  });
  expect(p).not.toContain("AVAILABLE ACTIONS");
});
