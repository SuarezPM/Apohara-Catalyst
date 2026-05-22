/**
 * TaskBoard store unit tests (spec §4).
 *
 * The DAG canvas and the TaskBoard kanban view MUST read from the same
 * source of truth, so these tests pin down the atom contract:
 *
 * - 7 mandated statuses
 * - empty initial state
 * - upsert groups by status
 * - remove drops the entry
 * - status mutation moves the task between groups
 *
 * Driven against `jotai/vanilla`'s `createStore` so the assertions stay
 * outside React's render lifecycle.
 */
import { expect, test } from "bun:test";
import { createStore } from "jotai/vanilla";
import {
	ALL_STATUSES,
	removeTaskAtom,
	tasksAtom,
	tasksByStatusAtom,
	upsertTaskAtom,
} from "../../src/store/dagStore.js";

test("ALL_STATUSES contains the 7 spec-mandated statuses", () => {
	expect(ALL_STATUSES.length).toBe(7);
	expect(ALL_STATUSES).toContain("pending");
	expect(ALL_STATUSES).toContain("blocked");
	expect(ALL_STATUSES).toContain("in_verification");
});

test("tasksAtom starts empty", () => {
	const store = createStore();
	expect(store.get(tasksAtom)).toEqual({});
});

test("upsertTaskAtom adds a task and tasksByStatusAtom groups it", () => {
	const store = createStore();
	store.set(upsertTaskAtom, {
		id: "t-1",
		title: "Hello",
		status: "pending",
	});
	const grouped = store.get(tasksByStatusAtom);
	expect(grouped.pending.length).toBe(1);
	expect(grouped.pending[0]?.id).toBe("t-1");
	expect(grouped.ready.length).toBe(0);
});

test("removeTaskAtom drops a task", () => {
	const store = createStore();
	store.set(upsertTaskAtom, { id: "t-1", title: "Hello", status: "pending" });
	store.set(removeTaskAtom, "t-1");
	expect(store.get(tasksAtom)).toEqual({});
});

test("upsertTaskAtom updates existing task in place", () => {
	const store = createStore();
	store.set(upsertTaskAtom, { id: "t-1", title: "Hello", status: "pending" });
	store.set(upsertTaskAtom, { id: "t-1", title: "Hello", status: "ready" });
	const grouped = store.get(tasksByStatusAtom);
	expect(grouped.pending.length).toBe(0);
	expect(grouped.ready.length).toBe(1);
});
