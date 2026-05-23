/**
 * Freeze + Careful modes — claude-octopus hallazgo 6 (G5.B.9).
 *
 * Apohara already has STATIC permission tiers (runner-policy
 * presets STRICT/BALANCED/PERMISSIVE). claude-octopus introduces
 * DYNAMIC per-session modes for "slow down here":
 *
 *   normal   — default. Permissions applied as configured by the
 *              session's static preset.
 *   careful  — agent must ASK before each tool call. Escalates what
 *              would normally auto-approve. Doesn't block; only
 *              delays. Useful when the user is uncertain about the
 *              agent's plan.
 *   freeze   — writes to a specific directory subtree are BLOCKED
 *              entirely until the user unfreezes. Read-only mode at
 *              the path-level (not the whole session). Useful for
 *              protecting `node_modules/`, vendored sources, etc.
 *
 * The two modes compose: careful=on + frozen=/secret/* means every
 * tool call asks, and every WRITE call against /secret is denied
 * outright.
 *
 * Pure value module. The orchestrator threads `CarefulModeState`
 * through tool gates; gates check `shouldAskBeforeToolCall` and
 * `isPathFrozen` before forwarding the tool to the provider.
 */

import { sep } from "node:path";

export interface CarefulModeState {
	careful: boolean;
	frozenPaths: string[];
}

export function newCarefulModeState(): CarefulModeState {
	return { careful: false, frozenPaths: [] };
}

export function isCarefulMode(s: CarefulModeState): boolean {
	return s.careful;
}

export type CarefulScope = "session" | "off";

export function setCarefulMode(
	s: CarefulModeState,
	scope: CarefulScope,
): CarefulModeState {
	return { ...s, careful: scope === "session" };
}

export function freezePath(
	s: CarefulModeState,
	path: string,
): CarefulModeState {
	if (s.frozenPaths.includes(path)) return s;
	return { ...s, frozenPaths: [...s.frozenPaths, path] };
}

export function unfreezePath(
	s: CarefulModeState,
	path: string,
): CarefulModeState {
	return { ...s, frozenPaths: s.frozenPaths.filter((p) => p !== path) };
}

/**
 * Check if `candidate` is at-or-below any frozen path. Uses
 * path-separator-aware prefix match so "/workspace/secret" matches
 * "/workspace/secret" AND "/workspace/secret/key" but NOT
 * "/workspace/secrets-other".
 */
export function isPathFrozen(
	s: CarefulModeState,
	candidate: string,
): boolean {
	for (const frozen of s.frozenPaths) {
		if (candidate === frozen) return true;
		const prefix = frozen.endsWith(sep) ? frozen : `${frozen}${sep}`;
		if (candidate.startsWith(prefix)) return true;
	}
	return false;
}

/**
 * Compute whether a pending tool call should require operator
 * approval. Combines:
 *   - careful mode: ANY tool call → ask.
 *   - freeze: any WRITE tool whose path is at-or-below a frozen
 *     scope → ask (the gate should still deny, but ask first for UX
 *     clarity).
 *
 * Read-style tools (Read, Glob, Grep) are not affected by freeze
 * because read-only access doesn't violate the frozen subtree
 * intent. Caller passes the tool name and target path; the heuristic
 * uses a known-list approach for read tools.
 */
const READ_TOOLS: ReadonlySet<string> = new Set(["Read", "Glob", "Grep", "LS"]);

export function shouldAskBeforeToolCall(
	s: CarefulModeState,
	toolName: string,
	path: string,
): boolean {
	if (s.careful) return true;
	if (isPathFrozen(s, path) && !READ_TOOLS.has(toolName)) return true;
	return false;
}
