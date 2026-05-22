import { describe, test, expect, expect as jestExpect } from "bun:test";
import { compileRunnerExecutionPlan } from "../../../../src/core/safety/runnerPolicy/planCompiler";
import { STRICT, BALANCED, ADVISORY, EXTERNAL_SANDBOX } from "../../../../src/core/safety/runnerPolicy/presets";

describe("planCompiler", () => {
  test("compile(STRICT) returns rejected=false and 6 enforcements", () => {
    const plan = compileRunnerExecutionPlan(STRICT);
    expect(plan.rejected).toBe(false);
    expect(plan.policy).toBe("Strict");
    expect(plan.enforcement).toHaveLength(6);
  });

  test("compile(ADVISORY) marks most areas as Advisory", () => {
    const plan = compileRunnerExecutionPlan(ADVISORY);
    expect(plan.rejected).toBe(false);
    const advisoryCount = plan.enforcement.filter(e => e.strength === "Advisory").length;
    const criticalAdvisory = plan.enforcement.filter(e => e.strength === "Advisory" && e.critical);
    expect(advisoryCount).toBeGreaterThan(0);
    expect(criticalAdvisory.length).toBeGreaterThan(0);
  });

  test("compile(BALANCED) has correct enforcement count", () => {
    const plan = compileRunnerExecutionPlan(BALANCED);
    expect(plan.enforcement).toHaveLength(6);
    expect(plan.policy).toBe("Balanced");
    expect(plan.rejected).toBe(false);
  });
});