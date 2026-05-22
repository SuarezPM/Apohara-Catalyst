/**
 * ExecutorAction — recursive action tree per spec §4.5
 * (vibe-kanban inspiration `crates/executors/src/actions/mod.rs:25-72`).
 *
 * Each session's work is a chain of actions: `setup script` → `coding`
 * agent → `review`/`follow_up` → `cleanup script`. The whole chain is
 * one persisted JSON blob so a run can be paused / resumed / replayed
 * without losing structure.
 *
 * v1 ships with two kinds wired into the dispatcher (`coding`,
 * `script`); `follow_up` and `review` types are reserved for the
 * Stage 8 continuation-turn + verification-mesh hookups.
 *
 *   {
 *     kind: 'coding',
 *     prompt: '…',
 *     systemPrompt: '…',
 *     next: {
 *       kind: 'review',
 *       criteria: ['lint passes', 'tests green'],
 *       next: { kind: 'script', command: 'apohara-postcommit', args: [...] }
 *     }
 *   }
 *
 * Callers MUST treat the chain as data, not control flow — the
 * dispatcher walks it iteratively.
 */
import type { ProviderId } from "../providers/agent-config.js";

export interface CodingAction {
	kind: "coding";
	prompt: string;
	systemPrompt?: string;
	providerId: ProviderId;
	next?: ExecutorAction;
}

export interface ScriptAction {
	kind: "script";
	/** Binary to execute. Spawned with the sandboxed env helper. */
	command: string;
	args: string[];
	/** Whether a non-zero exit aborts the chain (default true). */
	failOnNonZero?: boolean;
	next?: ExecutorAction;
}

export interface FollowUpAction {
	kind: "follow_up";
	/** The follow-up prompt; usually depends on the previous action's
	 * result content (the dispatcher folds the prior result into the
	 * system prompt). */
	prompt: string;
	providerId: ProviderId;
	next?: ExecutorAction;
}

export interface ReviewAction {
	kind: "review";
	/** Acceptance criteria evaluated post-hoc. */
	criteria: string[];
	/** Provider for the review judge. Falls back to the previous
	 * action's provider when absent. */
	providerId?: ProviderId;
	next?: ExecutorAction;
}

export type ExecutorAction =
	| CodingAction
	| ScriptAction
	| FollowUpAction
	| ReviewAction;

/**
 * Append `leaf` to the rightmost end of the chain rooted at `root`.
 * Mutates and returns the root for convenience.
 */
export function appendAction(
	root: ExecutorAction,
	leaf: ExecutorAction,
): ExecutorAction {
	let node = root;
	while (node.next) {
		node = node.next;
	}
	node.next = leaf;
	return root;
}

/** Linearize the chain for iteration. */
export function actionChain(root: ExecutorAction): ExecutorAction[] {
	const out: ExecutorAction[] = [];
	let node: ExecutorAction | undefined = root;
	while (node) {
		out.push(node);
		node = node.next;
	}
	return out;
}

export interface StartWorkspaceOptions {
	prompt: string;
	systemPrompt?: string;
	providerId: ProviderId;
}

/**
 * Build the canonical chain for "run a prompt and stop": just one
 * `coding` action. Future wirings — setup script, review judge,
 * post-commit cleanup — are composed by appending to the chain via
 * `appendAction`, not by rewriting callers.
 */
export function startWorkspace(opts: StartWorkspaceOptions): ExecutorAction {
	return {
		kind: "coding",
		prompt: opts.prompt,
		systemPrompt: opts.systemPrompt,
		providerId: opts.providerId,
	};
}
