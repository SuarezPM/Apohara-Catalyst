import { expect, test } from "bun:test";
import { DuplicateGuard, computeTaskFingerprint } from "../../../src/core/orchestration/duplicatePrevention";

test("computeTaskFingerprint is stable", () => {
  const a = computeTaskFingerprint({ prompt: "do X", provider: "claude", workspacePath: "/ws" });
  const b = computeTaskFingerprint({ prompt: "do X", provider: "claude", workspacePath: "/ws" });
  expect(a).toBe(b);
});

test("computeTaskFingerprint differs by prompt", () => {
  const a = computeTaskFingerprint({ prompt: "do X", provider: "claude", workspacePath: "/ws" });
  const b = computeTaskFingerprint({ prompt: "do Y", provider: "claude", workspacePath: "/ws" });
  expect(a).not.toBe(b);
});

test("DuplicateGuard rejects identical task within window", async () => {
  const g = new DuplicateGuard({ windowMs: 1000 });
  const task = { prompt: "ls", provider: "claude", workspacePath: "/x" };
  expect(g.shouldAccept(task)).toBe(true);
  expect(g.shouldAccept(task)).toBe(false); // duplicate
});

test("DuplicateGuard accepts duplicate after window expires", async () => {
  const g = new DuplicateGuard({ windowMs: 50 });
  const task = { prompt: "ls", provider: "claude", workspacePath: "/x" };
  expect(g.shouldAccept(task)).toBe(true);
  await new Promise((r) => setTimeout(r, 60));
  expect(g.shouldAccept(task)).toBe(true);
});

test("fingerprint resists delimiter collision (workspace contains pipe)", () => {
  // Pre-fix: provider="a", workspace="b|c", prompt="x" → "a|b|c|x"
  //         provider="a|b", workspace="c", prompt="x" → "a|b|c|x" ← COLLISION
  // Post-fix: JSON.stringify produces distinct serializations.
  const a = computeTaskFingerprint({ provider: "a", workspacePath: "b|c", prompt: "x" });
  const b = computeTaskFingerprint({ provider: "a|b", workspacePath: "c", prompt: "x" });
  expect(a).not.toBe(b);
});
