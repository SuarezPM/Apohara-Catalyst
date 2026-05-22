import { test, expect, beforeEach } from "bun:test";
import { ProviderSessionManager } from "../../../../src/core/providers/mixins/ProviderSessionManager";

let mgr: ProviderSessionManager;
beforeEach(() => { mgr = new ProviderSessionManager(); });

test("set + get returns matching session info", () => {
  mgr.set("apohara-sid-1", { providerId: "claude-sid-abc", taskId: "t-1" });
  expect(mgr.get("apohara-sid-1")?.providerId).toBe("claude-sid-abc");
  expect(mgr.toProviderId("apohara-sid-1")).toBe("claude-sid-abc");
  expect(mgr.toTaskId("apohara-sid-1")).toBe("t-1");
});

test("toProviderId throws on unknown apohara session", () => {
  expect(() => mgr.toProviderId("unknown")).toThrow();
});

test("delete removes the mapping", () => {
  mgr.set("apohara-sid-1", { providerId: "claude-sid-abc" });
  mgr.delete("apohara-sid-1");
  expect(mgr.get("apohara-sid-1")).toBeUndefined();
});

test("listAll returns all active mappings", () => {
  mgr.set("apohara-sid-1", { providerId: "claude-sid-A" });
  mgr.set("apohara-sid-2", { providerId: "codex-sid-B" });
  const all = mgr.listAll();
  expect(all.length).toBe(2);
});
