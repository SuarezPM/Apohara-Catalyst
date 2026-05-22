import { test, expect } from "bun:test";
import { runWithRequestContext, getRequestContext, getRequestLogger } from "../../../src/core/context/request-context";

test("runWithRequestContext sets dispatchId visible inside callback", async () => {
  await runWithRequestContext({ dispatchId: "disp-1", sessionId: "sess-A" }, async () => {
    const ctx = getRequestContext();
    expect(ctx?.dispatchId).toBe("disp-1");
    expect(ctx?.sessionId).toBe("sess-A");
  });
});

test("contexts do not leak between concurrent calls", async () => {
  const result = await Promise.all([
    runWithRequestContext({ dispatchId: "d1", sessionId: "s1" }, async () => {
      await new Promise(r => setTimeout(r, 5));
      return getRequestContext()?.dispatchId;
    }),
    runWithRequestContext({ dispatchId: "d2", sessionId: "s2" }, async () => {
      await new Promise(r => setTimeout(r, 5));
      return getRequestContext()?.dispatchId;
    }),
  ]);
  expect(result).toEqual(["d1", "d2"]);
});

test("getRequestContext returns undefined outside any run scope", () => {
  expect(getRequestContext()).toBeUndefined();
});

test("getRequestLogger returns a usable logger", async () => {
  await runWithRequestContext({ dispatchId: "d1", sessionId: "s1" }, async () => {
    const logger = getRequestLogger();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
    // Should not throw
    logger.info("test message");
  });
});
