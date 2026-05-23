/**
 * claude-octopus hallazgo 6 — Freeze + Careful modes (G5.B.9).
 *
 * Apohara already has static permission tiers (runner-policy
 * STRICT/BALANCED/PERMISSIVE). claude-octopus introduces *dynamic*
 * per-session modes for "slow down here":
 *
 *   normal   — default mode, all permissions applied as configured.
 *   careful  — agent should ASK before each tool call (escalate
 *              what would normally auto-approve). Doesn't block;
 *              only delays.
 *   freeze   — writes to a specific directory subtree are BLOCKED
 *              entirely until the user unfreezes. Read-only mode at
 *              the path-level (not the whole session).
 *
 *   newCarefulModeState() → state
 *   setCarefulMode(state, scope) → state' (scope = "session" | "off")
 *   freezePath(state, path) → state'
 *   unfreezePath(state, path) → state'
 *   isPathFrozen(state, candidatePath) → bool — checks every ancestor
 *   isCarefulMode(state) → bool
 *   shouldAskBeforeToolCall(state, toolName, path) → bool
 *
 * Pure value module — schedulers and tool gates check the state per
 * request.
 */
import { expect, test } from "bun:test";
import {
	freezePath,
	isCarefulMode,
	isPathFrozen,
	newCarefulModeState,
	setCarefulMode,
	shouldAskBeforeToolCall,
	unfreezePath,
} from "../../../src/core/dispatch/careful-mode";

test("newCarefulModeState defaults to normal mode with no frozen paths", () => {
	const s = newCarefulModeState();
	expect(isCarefulMode(s)).toBe(false);
	expect(s.frozenPaths).toEqual([]);
});

test("setCarefulMode flips careful flag, unset reverts to normal", () => {
	let s = newCarefulModeState();
	s = setCarefulMode(s, "session");
	expect(isCarefulMode(s)).toBe(true);
	s = setCarefulMode(s, "off");
	expect(isCarefulMode(s)).toBe(false);
});

test("freezePath adds path to frozen set; isPathFrozen detects exact match", () => {
	let s = newCarefulModeState();
	s = freezePath(s, "/workspace/secret");
	expect(isPathFrozen(s, "/workspace/secret")).toBe(true);
});

test("isPathFrozen detects ancestor frozen scope (descendants are also frozen)", () => {
	let s = newCarefulModeState();
	s = freezePath(s, "/workspace/secret");
	expect(isPathFrozen(s, "/workspace/secret/key.pem")).toBe(true);
	expect(isPathFrozen(s, "/workspace/secret/subdir/nested.txt")).toBe(true);
});

test("isPathFrozen does NOT match siblings or unrelated paths", () => {
	let s = newCarefulModeState();
	s = freezePath(s, "/workspace/secret");
	expect(isPathFrozen(s, "/workspace/other")).toBe(false);
	expect(isPathFrozen(s, "/workspace")).toBe(false); // parent is NOT frozen
	expect(isPathFrozen(s, "/workspace/secrets-other")).toBe(false); // prefix-without-/
});

test("unfreezePath removes exactly the requested path", () => {
	let s = newCarefulModeState();
	s = freezePath(s, "/a");
	s = freezePath(s, "/b");
	s = unfreezePath(s, "/a");
	expect(isPathFrozen(s, "/a")).toBe(false);
	expect(isPathFrozen(s, "/b")).toBe(true);
});

test("freezing the same path twice is idempotent (no duplicates)", () => {
	let s = newCarefulModeState();
	s = freezePath(s, "/x");
	s = freezePath(s, "/x");
	expect(s.frozenPaths).toEqual(["/x"]);
});

test("shouldAskBeforeToolCall: normal mode = false (no ask)", () => {
	const s = newCarefulModeState();
	expect(shouldAskBeforeToolCall(s, "Bash", "/workspace/x.ts")).toBe(false);
});

test("shouldAskBeforeToolCall: careful mode = true regardless of tool", () => {
	let s = newCarefulModeState();
	s = setCarefulMode(s, "session");
	expect(shouldAskBeforeToolCall(s, "Bash", "/workspace/x.ts")).toBe(true);
	expect(shouldAskBeforeToolCall(s, "Write", "/anywhere")).toBe(true);
});

test("shouldAskBeforeToolCall: frozen path always true for write tools", () => {
	let s = newCarefulModeState();
	s = freezePath(s, "/workspace/secret");
	// Bash is a write tool by convention; Read/Glob are not.
	expect(shouldAskBeforeToolCall(s, "Write", "/workspace/secret/key.pem")).toBe(true);
	expect(shouldAskBeforeToolCall(s, "Bash", "/workspace/secret/key.pem")).toBe(true);
});

test("shouldAskBeforeToolCall: frozen path does NOT trigger for Read", () => {
	let s = newCarefulModeState();
	s = freezePath(s, "/workspace/secret");
	expect(shouldAskBeforeToolCall(s, "Read", "/workspace/secret/key.pem")).toBe(false);
});
