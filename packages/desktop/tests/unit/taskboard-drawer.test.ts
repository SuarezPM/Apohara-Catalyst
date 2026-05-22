import { test, expect } from "bun:test";
import { createStore } from "jotai/vanilla";
import { selectedTaskIdAtom, openDrawerAtom, closeDrawerAtom } from "../../src/store/drawerStore.js";

test("drawer starts closed (null)", () => {
  const s = createStore();
  expect(s.get(selectedTaskIdAtom)).toBeNull();
});

test("openDrawerAtom sets selected task id", () => {
  const s = createStore();
  s.set(openDrawerAtom, "task-42");
  expect(s.get(selectedTaskIdAtom)).toBe("task-42");
});

test("closeDrawerAtom resets to null", () => {
  const s = createStore();
  s.set(openDrawerAtom, "task-42");
  s.set(closeDrawerAtom);
  expect(s.get(selectedTaskIdAtom)).toBeNull();
});

test("opening a different task replaces selection", () => {
  const s = createStore();
  s.set(openDrawerAtom, "a");
  s.set(openDrawerAtom, "b");
  expect(s.get(selectedTaskIdAtom)).toBe("b");
});