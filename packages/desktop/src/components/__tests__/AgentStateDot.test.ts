import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

const SRC = readFileSync(resolve(__dirname, "../AgentStateDot.tsx"), "utf-8");

test("AgentStateDot exports an AgentState type with the 5 expected variants", () => {
  expect(SRC).toMatch(/AgentState\s*=\s*['"]idle['"]\s*\|\s*['"]working['"]\s*\|\s*['"]waiting['"]\s*\|\s*['"]done['"]\s*\|\s*['"]error['"]/);
});

test("AgentStateDot maps working/done/error to lime/red palette via CSS vars", () => {
  expect(SRC).toContain("--apohara-lime");
  expect(SRC).toContain("--apohara-red");
});

test("AgentStateDot has animate-pulse OR keyframe animation when working", () => {
  // Either Tailwind 'animate-pulse' class OR plain CSS keyframe reference
  const hasPulse = /animate-pulse|animation\s*:.*pulse|keyframes/.test(SRC);
  expect(hasPulse).toBe(true);
});

test("AgentStateDot has role='status' for a11y", () => {
  expect(SRC).toContain('role="status"');
});
