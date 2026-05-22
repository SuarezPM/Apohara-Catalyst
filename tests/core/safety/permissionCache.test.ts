import { test, expect } from "bun:test";
import { PermissionCache } from "../../../src/core/safety/permissionCache";

test("add + has roundtrip", () => {
  const c = new PermissionCache();
  c.add("session-1", "Bash(npm test:*)");
  expect(c.has("session-1", "Bash(npm test:*)")).toBe(true);
  expect(c.has("session-1", "Bash(rm:*)")).toBe(false);
});

test("session-isolated: no leak between two sessions", () => {
  const c = new PermissionCache();
  c.add("session-A", "Bash(ls:*)");
  c.add("session-B", "Bash(rm:*)");
  expect(c.has("session-A", "Bash(ls:*)")).toBe(true);
  expect(c.has("session-A", "Bash(rm:*)")).toBe(false);
  expect(c.has("session-B", "Bash(rm:*)")).toBe(true);
  expect(c.has("session-B", "Bash(ls:*)")).toBe(false);
});

test("clear removes only target session", () => {
  const c = new PermissionCache();
  c.add("session-A", "Bash(ls:*)");
  c.add("session-B", "Bash(rm:*)");
  c.clear("session-A");
  expect(c.has("session-A", "Bash(ls:*)")).toBe(false);
  expect(c.has("session-B", "Bash(rm:*)")).toBe(true);
});

test("list returns all patterns for session", () => {
  const c = new PermissionCache();
  c.add("session-1", "Bash(npm:*)");
  c.add("session-1", "Edit(src/**)");
  const patterns = c.list("session-1");
  expect(patterns).toContain("Bash(npm:*)");
  expect(patterns).toContain("Edit(src/**)");
  expect(patterns.length).toBe(2);
});

test("list on unknown session returns empty", () => {
  const c = new PermissionCache();
  expect(c.list("nonexistent")).toEqual([]);
});
