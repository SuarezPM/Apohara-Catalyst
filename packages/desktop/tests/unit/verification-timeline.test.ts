import { test, expect } from "bun:test";
import { createStore } from "jotai/vanilla";
import {
  verificationAtom,
  setStepStatusAtom,
  resetVerificationAtom,
  verificationProgressAtom,
  ALL_STEPS,
} from "../../src/store/verificationStore.js";

test("ALL_STEPS has 5 spec-mandated steps in order", () => {
  expect(ALL_STEPS).toEqual([
    "lock_acquired", "agent_acted", "judge_scored", "critic_scored", "ledger_entry_hashed",
  ]);
});

test("initial state: all steps pending, no taskId", () => {
  const s = createStore();
  const v = s.get(verificationAtom);
  for (const step of ALL_STEPS) {
    expect(v.steps[step]).toBe("pending");
  }
  expect(v.taskId).toBeUndefined();
});

test("setStepStatusAtom flips one step", () => {
  const s = createStore();
  s.set(setStepStatusAtom, { step: "agent_acted", status: "done" });
  expect(s.get(verificationAtom).steps.agent_acted).toBe("done");
  expect(s.get(verificationAtom).steps.lock_acquired).toBe("pending");
});

test("resetVerificationAtom with taskId clears progress + sets taskId", () => {
  const s = createStore();
  s.set(setStepStatusAtom, { step: "agent_acted", status: "done" });
  s.set(resetVerificationAtom, "task-99");
  const v = s.get(verificationAtom);
  expect(v.steps.agent_acted).toBe("pending");
  expect(v.taskId).toBe("task-99");
});

test("verificationProgressAtom counts done steps", () => {
  const s = createStore();
  expect(s.get(verificationProgressAtom)).toEqual({ done: 0, total: 5, percent: 0 });
  s.set(setStepStatusAtom, { step: "lock_acquired", status: "done" });
  s.set(setStepStatusAtom, { step: "agent_acted", status: "done" });
  expect(s.get(verificationProgressAtom)).toEqual({ done: 2, total: 5, percent: 40 });
});

test("simulated run end-to-end: all 5 steps light up in order", () => {
  const s = createStore();
  for (const step of ALL_STEPS) {
    s.set(setStepStatusAtom, { step, status: "in_progress" });
    s.set(setStepStatusAtom, { step, status: "done" });
  }
  const v = s.get(verificationAtom);
  for (const step of ALL_STEPS) {
    expect(v.steps[step]).toBe("done");
  }
  expect(s.get(verificationProgressAtom).percent).toBe(100);
});