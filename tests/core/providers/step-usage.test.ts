/**
 * G5.A.4 — per-step (per-message) usage attribution (nimbalyst #1.4).
 *
 * Counter that tracks `{ inputTokens, outputTokens, cost }` per session;
 * each `record(sessionId, step)` appends a step and updates the running
 * cumulative. Used by sendMessage stream consumers and surfaced by
 * status-line + ledger writers.
 */
import { test, expect } from "bun:test";
import { StepUsageTracker } from "../../../src/core/providers/step-usage";

test("StepUsageTracker.record appends and cumulates", () => {
  const t = new StepUsageTracker();
  t.record("sess-1", { inputTokens: 10, outputTokens: 20, costUsd: 0.001 });
  t.record("sess-1", { inputTokens: 5, outputTokens: 15, costUsd: 0.0005 });
  const total = t.cumulative("sess-1");
  expect(total.inputTokens).toBe(15);
  expect(total.outputTokens).toBe(35);
  expect(total.costUsd).toBeCloseTo(0.0015, 5);
  expect(total.stepCount).toBe(2);
});

test("StepUsageTracker.steps returns all individual step records", () => {
  const t = new StepUsageTracker();
  t.record("sess-1", { inputTokens: 100, outputTokens: 200, costUsd: 0.01 });
  t.record("sess-1", { inputTokens: 50, outputTokens: 50, costUsd: 0.005 });
  const steps = t.steps("sess-1");
  expect(steps.length).toBe(2);
  expect(steps[0]?.inputTokens).toBe(100);
  expect(steps[1]?.outputTokens).toBe(50);
});

test("StepUsageTracker isolates by sessionId", () => {
  const t = new StepUsageTracker();
  t.record("a", { inputTokens: 1, outputTokens: 2, costUsd: 0 });
  t.record("b", { inputTokens: 10, outputTokens: 20, costUsd: 0 });
  expect(t.cumulative("a").inputTokens).toBe(1);
  expect(t.cumulative("b").inputTokens).toBe(10);
});

test("StepUsageTracker.cumulative on unknown session returns zeros", () => {
  const t = new StepUsageTracker();
  const c = t.cumulative("missing");
  expect(c.inputTokens).toBe(0);
  expect(c.outputTokens).toBe(0);
  expect(c.costUsd).toBe(0);
  expect(c.stepCount).toBe(0);
});

test("StepUsageTracker.reset clears a session", () => {
  const t = new StepUsageTracker();
  t.record("s", { inputTokens: 5, outputTokens: 5, costUsd: 1 });
  t.reset("s");
  expect(t.cumulative("s").inputTokens).toBe(0);
  expect(t.steps("s").length).toBe(0);
});

test("StepUsageTracker.recordFromUsage maps TokenUsage + pricing", () => {
  const t = new StepUsageTracker();
  t.recordFromUsage(
    "sess",
    { inputTokens: 1000, outputTokens: 500, totalTokens: 1500 },
    { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  );
  const cum = t.cumulative("sess");
  // 1000/1e6 * 3.0 + 500/1e6 * 15.0 = 0.003 + 0.0075 = 0.0105
  expect(cum.costUsd).toBeCloseTo(0.0105, 6);
  expect(cum.inputTokens).toBe(1000);
});
