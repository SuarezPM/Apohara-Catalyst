/**
 * G7.C.1 — PermissionGridPanel unit tests.
 *
 * These tests cover the jotai atom contract for the grid (the React
 * rendering surface is exercised by Playwright e2e). The grid model
 * itself is symmetric with the orchestrator-side
 * `src/core/safety/permissionGrid.ts` — same scopes, same states,
 * same "unset means delete" semantics.
 */
import { test, expect } from "bun:test";
import { createStore } from "jotai/vanilla";
import {
	PermissionGridPanel,
	permissionGridAtom,
	setGridCellAtom,
} from "../../src/components/PermissionGridPanel.js";

test("PermissionGridPanel exports a function component", () => {
	expect(typeof PermissionGridPanel).toBe("function");
});

test("setGridCellAtom inserts a new row keyed by (scope, resource)", () => {
	const s = createStore();
	s.set(setGridCellAtom, {
		scope: "session",
		resource: "Bash(rm:*)",
		state: "deny",
	});
	const grid = s.get(permissionGridAtom);
	expect(Object.keys(grid).length).toBe(1);
	const row = grid["session::Bash(rm:*)"];
	expect(row?.scope).toBe("session");
	expect(row?.resource).toBe("Bash(rm:*)");
	expect(row?.state).toBe("deny");
});

test("setGridCellAtom with state='unset' deletes the row", () => {
	const s = createStore();
	s.set(setGridCellAtom, {
		scope: "once",
		resource: "Bash(git:*)",
		state: "allow",
	});
	expect(Object.keys(s.get(permissionGridAtom)).length).toBe(1);
	s.set(setGridCellAtom, {
		scope: "once",
		resource: "Bash(git:*)",
		state: "unset",
	});
	expect(Object.keys(s.get(permissionGridAtom)).length).toBe(0);
});

test("same resource across 3 scopes is 3 independent cells", () => {
	const s = createStore();
	s.set(setGridCellAtom, {
		scope: "once",
		resource: "Read(/etc/*)",
		state: "allow",
	});
	s.set(setGridCellAtom, {
		scope: "session",
		resource: "Read(/etc/*)",
		state: "deny",
	});
	s.set(setGridCellAtom, {
		scope: "always",
		resource: "Read(/etc/*)",
		state: "deny",
	});
	const grid = s.get(permissionGridAtom);
	expect(Object.keys(grid).length).toBe(3);
	expect(grid["once::Read(/etc/*)"]?.state).toBe("allow");
	expect(grid["session::Read(/etc/*)"]?.state).toBe("deny");
	expect(grid["always::Read(/etc/*)"]?.state).toBe("deny");
});

test("setGridCellAtom unset on missing row is a no-op", () => {
	const s = createStore();
	s.set(setGridCellAtom, {
		scope: "always",
		resource: "Bash(curl:*)",
		state: "unset",
	});
	expect(Object.keys(s.get(permissionGridAtom)).length).toBe(0);
});

test("resource with '::' separator round-trips correctly", () => {
	const s = createStore();
	const tricky = "Bash(echo::weird)";
	s.set(setGridCellAtom, { scope: "session", resource: tricky, state: "allow" });
	const grid = s.get(permissionGridAtom);
	const row = grid[`session::${tricky}`];
	expect(row?.resource).toBe(tricky);
});
