import { test, expect } from "@playwright/test";

test("ViewToggle store updates via setViewModeAtom", async () => {
  // Pure store-level e2e since we don't have a backend running.
  const { createStore } = await import("jotai/vanilla");
  const { viewModeAtom, setViewModeAtom } = await import("../../src/store/viewStore.js");
  const store = createStore();
  expect(store.get(viewModeAtom)).toBe("graph");
  store.set(setViewModeAtom, "board");
  expect(store.get(viewModeAtom)).toBe("board");
});
