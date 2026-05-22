import { test, expect } from "bun:test";
import { createStore } from "jotai/vanilla";
import { viewModeAtom, setViewModeAtom } from "../../src/store/viewStore.js";

test("default view is graph", () => {
  const s = createStore();
  expect(s.get(viewModeAtom)).toBe("graph");
});

test("setViewModeAtom switches to board", () => {
  const s = createStore();
  s.set(setViewModeAtom, "board");
  expect(s.get(viewModeAtom)).toBe("board");
});

test("setViewModeAtom switches back to graph", () => {
  const s = createStore();
  s.set(setViewModeAtom, "board");
  s.set(setViewModeAtom, "graph");
  expect(s.get(viewModeAtom)).toBe("graph");
});