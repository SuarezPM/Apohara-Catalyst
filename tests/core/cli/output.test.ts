import { test, expect, spyOn } from "bun:test";
import { emitResult, emitError, emitDiagnostic, ApoharaError, installGlobalErrorHandlers, EXIT_SUCCESS, EXIT_USER_ERROR, EXIT_ENV_ERROR, type ApoharaErrorShape } from "../../../src/core/cli/output";

test("exit codes are 0, 1, 2", () => {
  expect(EXIT_SUCCESS).toBe(0);
  expect(EXIT_USER_ERROR).toBe(1);
  expect(EXIT_ENV_ERROR).toBe(2);
});

test("emitResult in text mode prints to stdout", () => {
  const stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true);
  emitResult({ ok: true, count: 3 }, { jsonMode: false });
  expect(stdoutSpy).toHaveBeenCalled();
  const arg = stdoutSpy.mock.calls[0][0];
  expect(typeof arg === "string" ? arg : arg.toString()).toContain("ok");
  stdoutSpy.mockRestore();
});

test("emitResult in JSON mode prints JSON to stdout", () => {
  const stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true);
  emitResult({ ok: true, count: 3 }, { jsonMode: true });
  expect(stdoutSpy).toHaveBeenCalled();
  const arg = stdoutSpy.mock.calls[0][0];
  const parsed = JSON.parse((typeof arg === "string" ? arg : arg.toString()).trim());
  expect(parsed).toEqual({ ok: true, count: 3 });
  stdoutSpy.mockRestore();
});

test("emitError in JSON mode prints {code, message, remediation} to stderr", () => {
  const stderrSpy = spyOn(process.stderr, "write").mockImplementation(() => true);
  emitError({ code: "AUTH_REQUIRED", message: "no token", remediation: "run `apohara provider connect github`" }, { jsonMode: true });
  expect(stderrSpy).toHaveBeenCalled();
  const arg = stderrSpy.mock.calls[0][0];
  const parsed = JSON.parse((typeof arg === "string" ? arg : arg.toString()).trim());
  expect(parsed.code).toBe("AUTH_REQUIRED");
  expect(parsed.message).toBe("no token");
  expect(parsed.remediation).toContain("apohara provider connect");
  stderrSpy.mockRestore();
});

test("ApoharaError has code, message, remediation, exitCode", () => {
  const e = new ApoharaError({ code: "FOO", message: "bar", remediation: "baz", exitCode: EXIT_USER_ERROR });
  expect(e.code).toBe("FOO");
  expect(e.message).toBe("bar");
  expect(e.remediation).toBe("baz");
  expect(e.exitCode).toBe(EXIT_USER_ERROR);
});

test("emitDiagnostic always goes to stderr, never contaminates stdout", () => {
  const stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true);
  const stderrSpy = spyOn(process.stderr, "write").mockImplementation(() => true);
  emitDiagnostic("processing batch 1/10", { jsonMode: true });
  expect(stdoutSpy).not.toHaveBeenCalled();
  expect(stderrSpy).toHaveBeenCalled();
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
});

test("installGlobalErrorHandlers is idempotent (no listener stacking)", () => {
  const before = process.listenerCount("uncaughtException");
  installGlobalErrorHandlers(false);
  installGlobalErrorHandlers(false);
  installGlobalErrorHandlers(true);
  const after = process.listenerCount("uncaughtException");
  expect(after).toBe(before + 1);  // only ONE listener net, not 3

  // Cleanup: install once more with jsonMode=false to restore default, then we can't easily remove globally
  // but at least the count is right
});

test("emitResult text mode handles cycles without crashing", () => {
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  const stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true);
  expect(() => emitResult(cyclic, { jsonMode: false })).not.toThrow();
  expect(stdoutSpy).toHaveBeenCalled();
  stdoutSpy.mockRestore();
});

test("emitResult text mode handles BigInt without crashing", () => {
  const stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true);
  expect(() => emitResult({ count: 9999999999999999n }, { jsonMode: false })).not.toThrow();
  expect(stdoutSpy).toHaveBeenCalled();
  stdoutSpy.mockRestore();
});

test("emitError fills missing remediation with placeholder", () => {
  const stderrSpy = spyOn(process.stderr, "write").mockImplementation(() => true);
  emitError({ code: "X", message: "msg" } as unknown as ApoharaErrorShape, { jsonMode: false });
  const arg = stderrSpy.mock.calls[0][0];
  const written = typeof arg === "string" ? arg : arg.toString();
  expect(written).toContain("remediation: (no remediation provided)");
  expect(written).not.toContain("undefined");
  stderrSpy.mockRestore();
});
