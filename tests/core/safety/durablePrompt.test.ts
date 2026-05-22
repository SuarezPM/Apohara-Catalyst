import { test, expect } from "bun:test";
import {
  DurablePromptStore,
  type PermissionRequest,
  type PermissionResponse,
} from "../../../src/core/safety/durablePrompt";

function mkReq(id: string): PermissionRequest {
  return {
    request_id: id,
    inv: { tool: "Bash", input: { command: "npm test" } },
    suggested_pattern: "Bash(npm:*)",
    available_scopes: ["once", "session", "always"],
    created_at: Date.now(),
  };
}

test("enqueueRequest + setResponse + waitForResponse roundtrip", async () => {
  const store = new DurablePromptStore();
  store.enqueueRequest(mkReq("req-1"));

  // Simulate user responding after a short delay.
  setTimeout(() => {
    store.setResponse({
      request_id: "req-1",
      decision: "allow",
      scope: "session",
      pattern: "Bash(npm test:*)",
    });
  }, 30);

  const resp = await store.waitForResponse("req-1", 2000, 10);
  expect(resp).not.toBeNull();
  expect(resp?.decision).toBe("allow");
  expect(resp?.scope).toBe("session");
  expect(resp?.pattern).toBe("Bash(npm test:*)");
});

test("waitForResponse times out with no response", async () => {
  const store = new DurablePromptStore();
  store.enqueueRequest(mkReq("req-timeout"));
  const resp = await store.waitForResponse("req-timeout", 50, 10);
  expect(resp).toBeNull();
});

test("listPending returns all enqueued requests", () => {
  const store = new DurablePromptStore();
  store.enqueueRequest(mkReq("req-A"));
  store.enqueueRequest(mkReq("req-B"));
  store.enqueueRequest(mkReq("req-C"));
  const pending = store.listPending();
  expect(pending.length).toBe(3);
  const ids = pending.map((r) => r.request_id).sort();
  expect(ids).toEqual(["req-A", "req-B", "req-C"]);
});

test("waitForResponse returns immediately if response already present", async () => {
  const store = new DurablePromptStore();
  store.enqueueRequest(mkReq("req-fast"));
  const r: PermissionResponse = { request_id: "req-fast", decision: "deny" };
  store.setResponse(r);
  const got = await store.waitForResponse("req-fast", 1000, 10);
  expect(got?.decision).toBe("deny");
});
