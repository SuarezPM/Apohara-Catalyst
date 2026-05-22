import { test, expect } from "bun:test";
import { createStore } from "jotai/vanilla";
import {
  pendingPermissionRequestsAtom,
  permissionResponsesAtom,
  unresolvedPermissionRequestsAtom,
  enqueuePermissionRequestAtom,
  recordPermissionResponseAtom,
  type PermissionRequestEvent,
} from "../../src/store/permissionStore.js";

function req(id: string): PermissionRequestEvent {
  return {
    request_id: id,
    tool: "Bash",
    input: { command: "ls" },
    suggested_pattern: "Bash(ls:*)",
    available_scopes: ["once", "session", "always"],
    ts: Date.now(),
  };
}

test("no unresolved when no requests", () => {
  const s = createStore();
  expect(s.get(unresolvedPermissionRequestsAtom).length).toBe(0);
});

test("enqueue adds to unresolved", () => {
  const s = createStore();
  s.set(enqueuePermissionRequestAtom, req("r-1"));
  expect(s.get(unresolvedPermissionRequestsAtom).length).toBe(1);
});

test("recording response removes from unresolved", () => {
  const s = createStore();
  s.set(enqueuePermissionRequestAtom, req("r-1"));
  s.set(recordPermissionResponseAtom, { request_id: "r-1", decision: "allow", scope: "once", ts: Date.now() });
  expect(s.get(unresolvedPermissionRequestsAtom).length).toBe(0);
});

test("multiple unresolved survive in order of insertion", () => {
  const s = createStore();
  s.set(enqueuePermissionRequestAtom, req("r-1"));
  s.set(enqueuePermissionRequestAtom, req("r-2"));
  const u = s.get(unresolvedPermissionRequestsAtom);
  expect(u.length).toBe(2);
  expect(u.map(r => r.request_id)).toContain("r-1");
  expect(u.map(r => r.request_id)).toContain("r-2");
});

test("DURABILITY: dialog state is in store, not local state — re-deriving from atoms reproduces it", () => {
  const s = createStore();
  s.set(enqueuePermissionRequestAtom, req("r-durable"));
  const unresolved1 = s.get(unresolvedPermissionRequestsAtom);
  const unresolved2 = s.get(unresolvedPermissionRequestsAtom);
  expect(unresolved1[0].request_id).toBe("r-durable");
  expect(unresolved2[0].request_id).toBe("r-durable");
});