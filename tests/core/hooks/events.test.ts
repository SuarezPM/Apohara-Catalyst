import { test, expect } from "bun:test";
import { parseHookEvent, type HookEvent } from "../../../src/core/hooks/events";

test("parses pre_tool_use envelope", () => {
  const raw = {
    type: "pre_tool_use",
    pane_key: "p1",
    task_id: "t-1",
    worktree_id: "wt-1",
    payload: { tool_name: "Bash", tool_input: { command: "ls" }, timestamp: 1737562800 },
  };
  const event = parseHookEvent(raw);
  expect(event.kind).toBe("pre_tool_use");
  expect(event.commonContext.paneKey).toBe("p1");
  expect(event.commonContext.taskId).toBe("t-1");
  if (event.kind === "pre_tool_use") {
    expect(event.toolName).toBe("Bash");
    expect(event.toolInput).toEqual({ command: "ls" });
  }
});

test("parses stop event with reason", () => {
  const raw = {
    type: "stop",
    pane_key: "p1",
    payload: { reason: "completed", timestamp: 1737562800 },
  };
  const event = parseHookEvent(raw);
  expect(event.kind).toBe("stop");
  if (event.kind === "stop") {
    expect(event.reason).toBe("completed");
  }
});

test("throws on unknown event type", () => {
  expect(() => parseHookEvent({ type: "made_up", pane_key: "p", payload: {} })).toThrow();
});

test("throws on malformed envelope (missing pane_key)", () => {
  expect(() => parseHookEvent({ type: "stop", payload: { reason: "completed", timestamp: 0 } })).toThrow();
});