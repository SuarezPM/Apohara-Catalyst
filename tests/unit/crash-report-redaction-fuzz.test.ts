import { expect, test } from "bun:test";
import { redactCrashReport } from "../../src/core/crash-reports/redactor";

const SECRETS = [
  "sk-ant-api03-abc123def456ghi789jkl012mno345pqr678stu901vwx234",
  "sk-proj-1234567890abcdefghij1234567890abcdef",
  "AKIAIOSFODNN7EXAMPLE",
  "ghp_abcdef0123456789abcdef0123456789abcdef",
];

test("redactCrashReport removes all known secret formats from message/stack/context", () => {
  for (const secret of SECRETS) {
    const report = {
      ts: 1,
      installId: "test-uuid",
      message: `Failed with ${secret}`,
      stack: `at foo (${secret}/x.ts:1:1)`,
      context: { key: secret, env: { TOKEN: secret } },
    };
    const redacted = redactCrashReport(report);
    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain(secret);
  }
});

test("redactCrashReport preserves non-secret content (stack trace, error messages)", () => {
  const report = {
    ts: 1,
    installId: "x",
    message: "TypeError: foo is not a function",
    stack: "at bar (/home/user/app.ts:42:10)",
    context: {},
  };
  const redacted = redactCrashReport(report);
  expect(redacted.message).toContain("TypeError");
  expect(redacted.stack).toContain("bar");
});
