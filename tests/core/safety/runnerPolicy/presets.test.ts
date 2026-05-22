import { describe, test, expect } from "bun:test";
import { STRICT, BALANCED, ADVISORY, EXTERNAL_SANDBOX } from "../../../../src/core/safety/runnerPolicy/presets";

describe("presets", () => {
  test("STRICT preset has 4+ protected paths", () => {
    expect(STRICT.preset).toBe("Strict");
    expect(STRICT.filesystem.protectedPaths.length).toBeGreaterThanOrEqual(4);
  });

  test("BALANCED preset allows external network by default", () => {
    expect(BALANCED.preset).toBe("Balanced");
    expect(BALANCED.network.defaultAction).toBe("allow");
  });

  test("EXTERNAL_SANDBOX inherits STRICT but enables sandbox", () => {
    expect(EXTERNAL_SANDBOX.preset).toBe("ExternalSandbox");
    expect(EXTERNAL_SANDBOX.external_sandbox.enabled).toBe(true);
    expect(EXTERNAL_SANDBOX.external_sandbox.tool).toBe("bwrap");
    expect(EXTERNAL_SANDBOX.filesystem.protectedPaths).toEqual(STRICT.filesystem.protectedPaths);
  });
});