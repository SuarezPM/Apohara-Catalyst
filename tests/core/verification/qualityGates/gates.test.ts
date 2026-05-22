import { test, expect } from "bun:test";
import { runAllGates, GATES } from "../../../../src/core/verification/qualityGates";

test("GATES registry has 6 gates", () => {
  expect(GATES.length).toBe(6);
});

test("sysadminSafetyGate blocks rm -rf /", () => {
  const r = runAllGates({
    taskRole: "coder",
    diff: "rm -rf /",
    output: "removed everything",
  });
  expect(r.blocks.some(b => b.gate === "sysadmin_safety")).toBe(true);
});

test("architectureGate blocks output without trade-offs for backend persona", () => {
  const r = runAllGates({
    taskRole: "coder",
    persona: "backend",
    diff: "+new microservice",
    output: "Built it.",
  });
  expect(r.blocks.some(b => b.gate === "architecture")).toBe(true);
});

test("architectureGate passes output with Trade-off + Alternatives considered", () => {
  const r = runAllGates({
    taskRole: "coder",
    persona: "backend",
    diff: "+new microservice",
    output: "We chose A. Alternatives considered: B (rejected for cost), C (rejected for latency). Trade-off: complexity for scale.",
  });
  expect(r.blocks.some(b => b.gate === "architecture")).toBe(false);
});

test("codeQualityGate blocks output with < 2 findings", () => {
  const r = runAllGates({
    taskRole: "critic",
    diff: "+ code",
    output: "Looks fine.",
  });
  expect(r.blocks.some(b => b.gate === "code_quality")).toBe(true);
});

test("frontendGate blocks output without ARIA mentions for frontend persona", () => {
  const r = runAllGates({
    taskRole: "coder",
    persona: "frontend",
    diff: "+button",
    output: "Added a button. Looks nice.",
  });
  expect(r.blocks.some(b => b.gate === "frontend")).toBe(true);
});

test("perfGate blocks output without metrics for perf persona", () => {
  const r = runAllGates({
    taskRole: "coder",
    persona: "perf",
    diff: "+cache layer for query results",
    output: "Made it faster.",
  });
  expect(r.blocks.some(b => b.gate === "perf")).toBe(true);
});