import { expect, test } from "bun:test";
import { redactCrashReport } from "../../../src/core/crash-reports/redactor";
import type { CrashReport } from "../../../src/core/crash-reports/jsonl";

test("redacts known secret formats from message + stack + context", () => {
  const report: CrashReport = {
    ts: 1,
    installId: "inst_aaaaaaaaaaaaaaaa",
    message:
      "Failed with sk-ant-api03-redactme123redactme123redactme123redactme123",
    stack:
      "Error: at /home/user/.apohara/run with ghp_redactme0123456789012345678901234567",
    context: {
      // sk- generic pattern requires >=32 chars after the dash
      apiKey: "sk-proj-redactme0123456789redactme012345",
      benign: "this is fine",
    },
  };
  const clean = redactCrashReport(report);
  const serialized = JSON.stringify(clean);
  expect(serialized).not.toContain("sk-ant-api03");
  expect(serialized).not.toContain("ghp_redactme");
  expect(serialized).not.toContain("sk-proj");
  expect(clean.context.benign).toBe("this is fine");
});

test("preserves non-secret content (stack traces, error names)", () => {
  const report: CrashReport = {
    ts: 1,
    installId: "x",
    message: "TypeError: foo is not a function",
    stack: "    at bar (/home/user/app.ts:42:10)",
    context: {},
  };
  const clean = redactCrashReport(report);
  expect(clean.message).toContain("TypeError");
  expect(clean.stack).toContain("bar");
  expect(clean.stack).toContain("app.ts:42:10");
});

test("redacts secrets in nested context objects", () => {
  const report: CrashReport = {
    ts: 1,
    installId: "x",
    message: "ok",
    stack: "",
    context: {
      nested: {
        token: "ghp_redactme0123456789012345678901234567",
        ok: 42,
      },
    },
  };
  const clean = redactCrashReport(report);
  const nested = clean.context.nested as Record<string, unknown>;
  expect(nested.token).toBe("[REDACTED]");
  expect(nested.ok).toBe(42);
});

test("redacts KV-style env dumps (FOO_API_KEY=value)", () => {
  const report: CrashReport = {
    ts: 1,
    installId: "x",
    message: "spawn failed: ANTHROPIC_API_KEY=sk-ant-leakedvalue123",
    stack: "",
    context: {},
  };
  const clean = redactCrashReport(report);
  expect(clean.message).toContain("ANTHROPIC_API_KEY=[REDACTED]");
  expect(clean.message).not.toContain("sk-ant-leakedvalue123");
});
