/**
 * Spec §10.6 — kanban/DAG sync via jotai store contract.
 *
 * The spec wording is "Mount TaskBoard + SwarmCanvas in test harness", but
 * `packages/desktop/src/store/dagStore.ts` is deliberately React-free
 * (imports from `jotai/vanilla`, not `jotai/react`) so the contract can be
 * exercised headlessly here. The React selector hook
 * `use-taskboard-store.ts` is a thin `useAtomValue` wrapper over the same
 * atoms — once vanilla propagation is correct, React propagation follows
 * by construction of `jotai/react`.
 *
 * Test plan:
 *   1. Both TaskBoard (`tasksByStatusAtom`) and a DAG-shaped derived atom
 *      (defined ad-hoc; SwarmCanvas's eventual shape is a node list keyed by
 *      id) subscribe to the same root `tasksAtom`. A mutation via
 *      `upsertTaskAtom` must surface in both within the same store tick.
 *   2. Status transitions move the task between kanban lanes AND update the
 *      DAG node's status field, with no intermediate flicker.
 *   3. `removeTaskAtom` drops the task from all derived views.
 *
 * This is the contract that would break in production if the store ever
 * accidentally split into two roots — exactly what the spec wants pinned
 * down.
 */
import { test, expect, describe } from "bun:test";
import { atom, createStore } from "jotai/vanilla";
import {
	tasksAtom,
	tasksByStatusAtom,
	upsertTaskAtom,
	removeTaskAtom,
	ALL_STATUSES,
	type DagTask,
} from "../../packages/desktop/src/store/dagStore";

/**
 * DAG-shaped derived atom — mirrors what SwarmCanvas needs: a flat node list
 * with id + status, sorted for stable rendering. Defined here (not in the
 * store) because SwarmCanvas hasn't landed yet; the test pins the contract
 * the canvas will rely on.
 */
const dagNodesAtom = atom((get) => {
	const tasks = get(tasksAtom);
	return Object.values(tasks)
		.map((t) => ({ id: t.id, status: t.status, title: t.title }))
		.sort((a, b) => a.id.localeCompare(b.id));
});

function mkTask(overrides: Partial<DagTask> & Pick<DagTask, "id">): DagTask {
	return {
		title: `task ${overrides.id}`,
		status: "pending",
		...overrides,
	};
}

describe("kanban/DAG sync via jotai store contract (§10.6)", () => {
	test("ALL_STATUSES has the 7 spec statuses in spec order", () => {
		// Lane order matters — see dagStore.ts docstring.
		expect(ALL_STATUSES).toEqual([
			"pending",
			"ready",
			"dispatched",
			"in_verification",
			"done",
			"failed",
			"blocked",
		]);
	});

	test("upserting a task surfaces in BOTH kanban and DAG views", () => {
		const store = createStore();

		// Sanity: empty start.
		expect(store.get(tasksByStatusAtom).pending).toEqual([]);
		expect(store.get(dagNodesAtom)).toEqual([]);

		// Subscribe BEFORE the mutation so we can prove the notification fires.
		let kanbanNotifications = 0;
		let dagNotifications = 0;
		const unsubKanban = store.sub(tasksByStatusAtom, () => {
			kanbanNotifications++;
		});
		const unsubDag = store.sub(dagNodesAtom, () => {
			dagNotifications++;
		});

		const t = mkTask({ id: "t1", title: "first" });
		store.set(upsertTaskAtom, t);

		// Both subscribers got at least one update for the single mutation.
		expect(kanbanNotifications).toBeGreaterThanOrEqual(1);
		expect(dagNotifications).toBeGreaterThanOrEqual(1);

		// Both derived views now show the task with the same identity.
		const kanban = store.get(tasksByStatusAtom);
		const dag = store.get(dagNodesAtom);
		expect(kanban.pending).toHaveLength(1);
		expect(kanban.pending[0]?.id).toBe("t1");
		expect(dag).toHaveLength(1);
		expect(dag[0]?.id).toBe("t1");
		expect(dag[0]?.status).toBe("pending");

		unsubKanban();
		unsubDag();
	});

	test("status transition moves task between kanban lanes AND updates DAG node", () => {
		const store = createStore();
		store.set(upsertTaskAtom, mkTask({ id: "t2", status: "pending" }));

		// Pre-transition: in `pending`, not in `done`.
		expect(store.get(tasksByStatusAtom).pending.map((x) => x.id)).toEqual(["t2"]);
		expect(store.get(tasksByStatusAtom).done).toEqual([]);
		expect(store.get(dagNodesAtom)[0]?.status).toBe("pending");

		// Transition: pending → in_verification → done. Each tick both views
		// must agree — no kanban-shows-X-but-DAG-shows-Y.
		for (const next of ["in_verification", "done"] as const) {
			store.set(upsertTaskAtom, mkTask({ id: "t2", status: next }));
			const kanban = store.get(tasksByStatusAtom);
			const dag = store.get(dagNodesAtom);

			// Task lives in exactly one lane (the new one).
			const lanesContainingT2 = ALL_STATUSES.filter((s) =>
				kanban[s].some((task) => task.id === "t2"),
			);
			expect(lanesContainingT2).toEqual([next]);

			// DAG node carries the same status.
			expect(dag.find((n) => n.id === "t2")?.status).toBe(next);
		}
	});

	test("multiple tasks across different lanes stay consistent under interleaved mutations", () => {
		const store = createStore();

		store.set(upsertTaskAtom, mkTask({ id: "a", status: "pending" }));
		store.set(upsertTaskAtom, mkTask({ id: "b", status: "ready" }));
		store.set(upsertTaskAtom, mkTask({ id: "c", status: "dispatched" }));
		store.set(upsertTaskAtom, mkTask({ id: "d", status: "blocked", blockedReason: "dep" }));

		const kanban = store.get(tasksByStatusAtom);
		const dag = store.get(dagNodesAtom);

		expect(kanban.pending.map((x) => x.id)).toEqual(["a"]);
		expect(kanban.ready.map((x) => x.id)).toEqual(["b"]);
		expect(kanban.dispatched.map((x) => x.id)).toEqual(["c"]);
		expect(kanban.blocked.map((x) => x.id)).toEqual(["d"]);
		expect(dag.map((n) => n.id)).toEqual(["a", "b", "c", "d"]);

		// Promote `a` to `ready`; `b` should still be in `ready` too.
		store.set(upsertTaskAtom, mkTask({ id: "a", status: "ready" }));
		const kanban2 = store.get(tasksByStatusAtom);
		expect(kanban2.pending).toEqual([]);
		expect(kanban2.ready.map((x) => x.id).sort()).toEqual(["a", "b"]);
		// DAG count unchanged, statuses reflected.
		expect(store.get(dagNodesAtom)).toHaveLength(4);
		expect(store.get(dagNodesAtom).find((n) => n.id === "a")?.status).toBe("ready");
	});

	test("removeTaskAtom drops task from kanban AND DAG", () => {
		const store = createStore();
		store.set(upsertTaskAtom, mkTask({ id: "x", status: "done" }));
		store.set(upsertTaskAtom, mkTask({ id: "y", status: "done" }));
		expect(store.get(tasksByStatusAtom).done).toHaveLength(2);
		expect(store.get(dagNodesAtom)).toHaveLength(2);

		store.set(removeTaskAtom, "x");

		const kanban = store.get(tasksByStatusAtom);
		const dag = store.get(dagNodesAtom);
		expect(kanban.done.map((t) => t.id)).toEqual(["y"]);
		expect(dag.map((n) => n.id)).toEqual(["y"]);

		// Removing a nonexistent id is a no-op (doesn't throw, doesn't drop others).
		expect(() => store.set(removeTaskAtom, "does-not-exist")).not.toThrow();
		expect(store.get(dagNodesAtom)).toHaveLength(1);
	});

	test("two independent stores don't leak state into each other", () => {
		// Confirms `createStore()` gives a fresh root each time — important
		// because the app holds one global store but tests need isolation.
		const storeA = createStore();
		const storeB = createStore();
		storeA.set(upsertTaskAtom, mkTask({ id: "only-in-a" }));
		expect(storeA.get(dagNodesAtom)).toHaveLength(1);
		expect(storeB.get(dagNodesAtom)).toHaveLength(0);
	});
});
