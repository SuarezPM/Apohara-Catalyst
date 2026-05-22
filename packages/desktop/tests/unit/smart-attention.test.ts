/**
 * use-taskboard-smart-attention unit tests (Task 7.4, spec §4 + culture #3).
 *
 * The 4-tier UI classifier sits on top of apohara-attention's HOT/WARM/COOL/IDLE
 * band crate (Stage 1.13). This pure-function layer maps each task's status into
 * one of 4 user-facing classes, sorts by tier ASC then timestamp DESC, and
 * promotes a pane's class to the most urgent tier present (NeedsYou > Idle).
 *
 * Pure-function tests only — the React hook itself is exercised through the
 * panel integration tests (taskboard panels). We don't need a renderer here.
 */
import { test, expect } from "bun:test";
// Import the pure-function module directly (not the React hook re-export) so
// the test does NOT pull in `react` via jotai/react. The hook file's public
// surface is identical via re-export; this keeps the test side-effect-free.
import {
	classifyTask,
	sortByAttention,
	promotePaneClass,
	TIER_ORDER,
	type AttentionTask,
} from "../../src/components/TaskBoard/hooks/smart-attention.js";
import type { DagTask } from "../../src/store/dagStore.js";

function task(over: Partial<DagTask>): DagTask {
	return { id: "t-x", title: "T", status: "pending", ...over };
}

test("blocked → NeedsYou", () => {
	expect(classifyTask(task({ status: "blocked" })).attentionTier).toBe(
		"NeedsYou",
	);
});

test("dispatched + in_verification → Working", () => {
	expect(classifyTask(task({ status: "dispatched" })).attentionTier).toBe(
		"Working",
	);
	expect(classifyTask(task({ status: "in_verification" })).attentionTier).toBe(
		"Working",
	);
});

test("done + failed → Done", () => {
	expect(classifyTask(task({ status: "done" })).attentionTier).toBe("Done");
	expect(classifyTask(task({ status: "failed" })).attentionTier).toBe("Done");
});

test("pending + ready → Idle", () => {
	expect(classifyTask(task({ status: "pending" })).attentionTier).toBe("Idle");
	expect(classifyTask(task({ status: "ready" })).attentionTier).toBe("Idle");
});

test("TIER_ORDER puts NeedsYou first, Idle last", () => {
	expect(TIER_ORDER.NeedsYou).toBe(0);
	expect(TIER_ORDER.Working).toBe(1);
	expect(TIER_ORDER.Done).toBe(2);
	expect(TIER_ORDER.Idle).toBe(3);
});

test("sortByAttention puts NeedsYou before Working before Done before Idle", () => {
	const ts = Date.now();
	const t: AttentionTask[] = [
		{
			...task({ id: "a", status: "done" }),
			attentionTier: "Done",
			attentionTimestamp: ts,
		},
		{
			...task({ id: "b", status: "blocked" }),
			attentionTier: "NeedsYou",
			attentionTimestamp: ts,
		},
		{
			...task({ id: "c", status: "pending" }),
			attentionTier: "Idle",
			attentionTimestamp: ts,
		},
		{
			...task({ id: "d", status: "dispatched" }),
			attentionTier: "Working",
			attentionTimestamp: ts,
		},
	];
	const sorted = sortByAttention(t);
	expect(sorted.map((s) => s.id)).toEqual(["b", "d", "a", "c"]);
});

test("sortByAttention tie-breaks within tier by timestamp DESC", () => {
	const t: AttentionTask[] = [
		{
			...task({ id: "old" }),
			attentionTier: "Working",
			attentionTimestamp: 100,
		},
		{
			...task({ id: "new" }),
			attentionTier: "Working",
			attentionTimestamp: 200,
		},
	];
	const sorted = sortByAttention(t);
	expect(sorted.map((s) => s.id)).toEqual(["new", "old"]);
});

test("promotePaneClass returns the most urgent tier", () => {
	expect(promotePaneClass(["Working", "Idle", "NeedsYou"])).toBe("NeedsYou");
	expect(promotePaneClass(["Done", "Idle"])).toBe("Done");
	expect(promotePaneClass([])).toBe("Idle");
});
