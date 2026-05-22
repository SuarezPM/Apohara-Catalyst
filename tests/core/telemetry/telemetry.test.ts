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
