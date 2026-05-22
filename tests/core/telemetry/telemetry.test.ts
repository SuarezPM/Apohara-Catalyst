import { test, expect } from "bun:test";
import { TelemetrySink, ALLOWED_EVENTS, isAllowedEvent, scrubProperties } from "../../../src/core/telemetry";

test("ALLOWED_EVENTS contains init_started and doctor_passed", () => {
  expect(ALLOWED_EVENTS).toContain("init_started");
  expect(ALLOWED_EVENTS).toContain("doctor_passed");
});

test("isAllowedEvent rejects unknown event types", () => {
  expect(isAllowedEvent("init_started")).toBe(true);
  expect(isAllowedEvent("never_heard_of_this")).toBe(false);
});

test("scrubProperties drops PII / secret keys", () => {
  const props = {
    provider: "claude",
    repo_url: "https://github.com/Foo/Bar",
    file_path: "/Users/me/secret/.env",
    source_code_diff: "+const KEY=...",
    duration_ms: 1234,
    outcome: "success",
  };
  const out = scrubProperties(props);
  expect(out.provider).toBe("claude");
  expect(out.duration_ms).toBe(1234);
  expect(out.outcome).toBe("success");
  expect(out.repo_url).toBeUndefined();
  expect(out.file_path).toBeUndefined();
  expect(out.source_code_diff).toBeUndefined();
});

test("disabled sink does not invoke the transport", async () => {
  let calls = 0;
  const sink = new TelemetrySink({
    enabled: false,
    installId: "inst_test",
    transport: async () => { calls += 1; },
  });
  await sink.record("init_started", { provider: "claude" });
  expect(calls).toBe(0);
});

test("enabled sink invokes transport with sanitized payload", async () => {
  const records: unknown[] = [];
  const sink = new TelemetrySink({
    enabled: true,
    installId: "inst_test",
    transport: async (event) => { records.push(event); },
  });
  await sink.record("provider_connect_succeeded", { provider: "github", repo_url: "leak" });
  expect(records.length).toBe(1);
  const rec = records[0] as { event: string; properties: Record<string, unknown>; installId: string };
  expect(rec.event).toBe("provider_connect_succeeded");
  expect(rec.installId).toBe("inst_test");
  expect(rec.properties.provider).toBe("github");
  expect(rec.properties.repo_url).toBeUndefined();
});

test("ALLOWED_EVENTS has exactly the 15 spec-mandated entries", () => {
  // Roll-call: locks the list against silent drift if spec adds/removes events
  const expected = new Set([
    "init_started", "init_completed",
    "provider_connect_started", "provider_connect_succeeded", "provider_connect_failed",
    "doctor_started", "doctor_passed", "doctor_failed",
    "agent_spawn", "task_assigned", "task_completed", "task_failed", "task_blocked",
    "pr_opened", "release_promoted",
  ]);
  expect(ALLOWED_EVENTS.length).toBe(15);
  for (const e of ALLOWED_EVENTS) {
    expect(expected.has(e)).toBe(true);
  }
});

test("APOHARA_TELEMETRY_DISABLED=1 env var overrides enabled:true at construction", async () => {
  const prev = process.env.APOHARA_TELEMETRY_DISABLED;
  process.env.APOHARA_TELEMETRY_DISABLED = "1";
  try {
    let calls = 0;
    const sink = new TelemetrySink({
      enabled: true,
      installId: "inst_envtest",
      transport: async () => { calls += 1; },
    });
    await sink.record("init_started", {});
    expect(calls).toBe(0);
  } finally {
    if (prev === undefined) delete process.env.APOHARA_TELEMETRY_DISABLED;
    else process.env.APOHARA_TELEMETRY_DISABLED = prev;
  }
});

test("scrubProperties drops email, user_id, account_id (PII hardening)", () => {
  const props = {
    email: "alice@example.com",
    user_id: "u-123",
    account_id: "acc-456",
    provider: "claude",
  };
  const out = scrubProperties(props);
  expect(out.provider).toBe("claude");
  expect(out.email).toBeUndefined();
  expect(out.user_id).toBeUndefined();
  expect(out.account_id).toBeUndefined();
});

test("scrubProperties truncates strings longer than MAX_STRING_LENGTH", () => {
  const longString = "x".repeat(500);
  const out = scrubProperties({ stack_trace: longString });
  // stack_trace isn't on the denylist, so it passes through truncated
  expect(typeof out.stack_trace).toBe("string");
  expect((out.stack_trace as string).length).toBeLessThanOrEqual(201); // 200 chars + "…"
  expect((out.stack_trace as string).endsWith("…")).toBe(true);
});

test("scrubProperties drops non-deny key with object value (value-type filter)", () => {
  const out = scrubProperties({
    provider: "claude",
    raw_object: { nested: { thing: 42 } },
    raw_array: [1, 2, 3],
  });
  expect(out.provider).toBe("claude");
  expect(out.raw_object).toBeUndefined();
  expect(out.raw_array).toBeUndefined();
});

test("scrubProperties handles empty properties object", () => {
  const out = scrubProperties({});
  expect(Object.keys(out).length).toBe(0);
});
