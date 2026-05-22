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

test("nested runWithRequestContext: inner replaces outer, outer restored after", async () => {
  await runWithRequestContext({ dispatchId: "outer", sessionId: "S" }, async () => {
    expect(getRequestContext()?.dispatchId).toBe("outer");
    await runWithRequestContext({ dispatchId: "inner", sessionId: "S" }, async () => {
      expect(getRequestContext()?.dispatchId).toBe("inner");
    });
    // After inner returns, outer is restored
    expect(getRequestContext()?.dispatchId).toBe("outer");
  });
});

test("getRequestContext is undefined after a throw inside runWithRequestContext", async () => {
  await expect(
    runWithRequestContext({ dispatchId: "d", sessionId: "s" }, async () => {
      throw new Error("inside");
    }),
  ).rejects.toThrow("inside");
  // After the throw bubbles, no context lingers
  expect(getRequestContext()).toBeUndefined();
});

test("getRequestLogger outside any scope returns a usable no-op-prefix logger", () => {
  const logger = getRequestLogger();
  expect(typeof logger.info).toBe("function");
  // Should not throw
  expect(() => logger.info("test outside scope")).not.toThrow();
});

test("taskId is included in logger prefix when present", async () => {
  const captured: string[] = [];
  const origLog = console.log;
  console.log = (...args) => { captured.push(args.join(" ")); };
  try {
    await runWithRequestContext({ dispatchId: "d1", sessionId: "s1", taskId: "t99" }, async () => {
      const logger = getRequestLogger();
      logger.info("hi");
    });
  } finally {
    console.log = origLog;
  }
  expect(captured.length).toBeGreaterThan(0);
  expect(captured[0]).toContain("[d1/s1/t99]");
});
