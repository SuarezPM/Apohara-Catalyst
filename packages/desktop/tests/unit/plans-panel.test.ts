import { test, expect } from "bun:test";
import { createStore } from "jotai/vanilla";
import { plansAtom, planFiltersAtom, filteredPlansAtom, upsertPlanAtom, removePlanAtom, type PlanSummary } from "../../src/store/plansStore.js";

function plan(over: Partial<PlanSummary>): PlanSummary {
  return {
    planId: "p-1",
    filepath: "/tmp/p.md",
    title: "Test",
    status: "active",
    agentSessions: [],
    ...over,
  };
}

test("plansAtom starts empty", () => {
  const store = createStore();
  expect(store.get(plansAtom)).toEqual({});
});

test("upsertPlanAtom + filteredPlansAtom roundtrip", () => {
  const store = createStore();
  store.set(upsertPlanAtom, plan({ planId: "p-1", title: "Plan 1" }));
  store.set(upsertPlanAtom, plan({ planId: "p-2", title: "Plan 2", status: "draft" }));
  const filtered = store.get(filteredPlansAtom);
  expect(filtered.length).toBe(2);
});

test("filter by status reduces result set", () => {
  const store = createStore();
  store.set(upsertPlanAtom, plan({ planId: "p-1", status: "active" }));
  store.set(upsertPlanAtom, plan({ planId: "p-2", status: "draft" }));
  store.set(planFiltersAtom, { status: "active" });
  expect(store.get(filteredPlansAtom).length).toBe(1);
});

test("filter by tag matches plans that include the tag", () => {
  const store = createStore();
  store.set(upsertPlanAtom, plan({ planId: "p-1", tags: ["auth", "api"] }));
  store.set(upsertPlanAtom, plan({ planId: "p-2", tags: ["ui"] }));
  store.set(planFiltersAtom, { tag: "auth" });
  const filtered = store.get(filteredPlansAtom);
  expect(filtered.length).toBe(1);
  expect(filtered[0].planId).toBe("p-1");
});

test("removePlanAtom drops the entry", () => {
  const store = createStore();
  store.set(upsertPlanAtom, plan({ planId: "p-1" }));
  store.set(removePlanAtom, "p-1");
  expect(store.get(plansAtom)).toEqual({});
});