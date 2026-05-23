import { expect, test } from "bun:test";
import { detectPoisonedSession, quarantineSession } from "../../../src/core/orchestration/poisonedSessions";

test("detects session with malformed JSON in last message", () => {
  const session = {
    id: "sess-1",
    messages: [
      { role: "user", content: "hello" },
      { role: "assistant", content: "{ not valid json" }, // poisoned
    ],
  };
  expect(detectPoisonedSession(session)).toBe(true);
});

test("detects session with cycle in tool_use IDs", () => {
  const session = {
    id: "sess-2",
    messages: [
      { role: "assistant", content: "", tool_use_id: "t1", parent_tool_use_id: "t2" },
      { role: "assistant", content: "", tool_use_id: "t2", parent_tool_use_id: "t1" },
    ],
  };
  expect(detectPoisonedSession(session)).toBe(true);
});

test("does NOT flag well-formed session", () => {
  const session = {
    id: "sess-ok",
    messages: [
      { role: "user", content: "hi" },
      { role: "assistant", content: '{"valid": "json"}' },
    ],
  };
  expect(detectPoisonedSession(session)).toBe(false);
});

test("quarantineSession returns archived path", () => {
  const session = { id: "sess-1", messages: [] };
  const archived = quarantineSession(session);
  expect(archived).toMatch(/quarantine\/sess-1-\d+\.json$/);
});
