/**
 * Reaction Engine E2E (G6.D.12).
 *
 * Drives the full GitHub → reactor pipeline from the TS surface,
 * verifying:
 *
 *   1. A canonical happy path: `opened → labeled → review_requested →
 *      closed (merged)` reaches the merged terminal state.
 *   2. All 13 lifecycle states are reachable via SOME path through the
 *      reaction-trigger surface (we don't reach merged twice — we
 *      exercise each state at least once across the dataset).
 *
 * The Rust-side `Reactor` lives across the daemon FFI boundary; in this
 * test we simulate it with a TS-only fake that mirrors its semantics
 * (states + transitions + 12 builtin actions). That fake is THE same
 * shape as the Rust state machine — the contract under test is the
 * trigger mapping and the chain orchestration, not the Rust internals
 * (those are exercised in `apohara-reaction-engine` and
 * `apohara-daemon` unit tests).
 */
import { test, expect } from "bun:test";
import {
	dispatchTrigger,
	type GitHubIssueEvent,
	type ReactionTriggerEvent,
} from "../../packages/github-bridge/src/reaction-trigger";

type State =
	| "issue_opened"
	| "triaged"
	| "routed"
	| "in_progress"
	| "reviewing"
	| "merged"
	| "closed"
	| "stale"
	| "needs_clarification"
	| "blocked"
	| "escalated"
	| "rejected"
	| "rescheduled";

const ALL_STATES: readonly State[] = [
	"issue_opened",
	"triaged",
	"routed",
	"in_progress",
	"reviewing",
	"merged",
	"closed",
	"stale",
	"needs_clarification",
	"blocked",
	"escalated",
	"rejected",
	"rescheduled",
] as const;

const TERMINAL: ReadonlySet<State> = new Set([
	"merged",
	"closed",
	"stale",
	"rejected",
]);

// Subset of legal transitions sufficient to traverse every state. Mirrors
// apohara_reaction_engine::state_machine::is_legal_transition for the
// edges we exercise in this test.
const LEGAL: Readonly<Record<State, readonly State[]>> = {
	issue_opened: ["triaged", "closed", "stale", "rejected"],
	triaged: ["routed", "needs_clarification", "closed", "stale", "rejected"],
	routed: ["in_progress", "escalated", "rescheduled", "closed", "stale", "rejected"],
	in_progress: [
		"reviewing",
		"needs_clarification",
		"blocked",
		"escalated",
		"rescheduled",
		"closed",
		"stale",
		"rejected",
	],
	reviewing: ["merged", "needs_clarification", "blocked", "escalated", "rescheduled", "closed", "stale", "rejected"],
	needs_clarification: ["triaged", "in_progress", "reviewing", "closed", "stale", "rejected"],
	blocked: ["in_progress", "reviewing", "closed", "stale", "rejected"],
	escalated: ["in_progress", "reviewing", "closed", "stale", "rejected"],
	rescheduled: ["routed", "in_progress", "closed", "stale", "rejected"],
	merged: [],
	closed: [],
	stale: [],
	rejected: [],
};

interface FakeReactor {
	machines: Map<string, State[]>;
	visited: Set<State>;
	apply: (issueId: string, action: string) => { ok: boolean; current: State };
}

function makeReactor(): FakeReactor {
	const machines = new Map<string, State[]>();
	const visited = new Set<State>(["issue_opened"]);
	const ACTION_TO_TARGET: Record<string, State> = {
		triage: "triaged",
		route: "routed",
		start: "in_progress",
		review: "reviewing",
		merge: "merged",
		close: "closed",
		mark_stale: "stale",
		request_clarification: "needs_clarification",
		block: "blocked",
		escalate: "escalated",
		reschedule: "rescheduled",
		reject: "rejected",
	};
	return {
		machines,
		visited,
		apply(issueId, action) {
			const target = ACTION_TO_TARGET[action];
			if (!target) return { ok: false, current: "issue_opened" };
			const history = machines.get(issueId) ?? ["issue_opened"];
			const current = history[history.length - 1] ?? "issue_opened";
			if (TERMINAL.has(current)) {
				return { ok: false, current };
			}
			const allowed = LEGAL[current] ?? [];
			if (!allowed.includes(target)) {
				return { ok: false, current };
			}
			history.push(target);
			machines.set(issueId, history);
			visited.add(target);
			return { ok: true, current: target };
		},
	};
}

const REACTIONS_CONF: Readonly<Record<string, readonly string[]>> = {
	issue_opened: ["triage", "route", "start"],
	review_requested: ["review"],
	issue_closed: ["merge"],
	issue_labeled: [], // no-op; useful for "trigger received, no transitions"
};

function mkGhEvent(
	action: GitHubIssueEvent["action"],
	number = 7,
	repo = "SuarezPM/Apohara",
): GitHubIssueEvent {
	return {
		action,
		issue: { number, title: "demo", state: "open" },
		repository: { full_name: repo },
	};
}

async function fire(
	event: GitHubIssueEvent,
	reactor: FakeReactor,
	steps: string[] = [],
): Promise<{ ok: boolean; events: ReactionTriggerEvent[] }> {
	const events: ReactionTriggerEvent[] = [];
	const result = await dispatchTrigger(
		event,
		(e) => {
			events.push(e);
		},
		{ APOHARA_REACTIONS: "1" },
	);
	if (!result.dispatched) return { ok: false, events };
	const chain = steps.length > 0 ? steps : (REACTIONS_CONF[result.event!.trigger] ?? []);
	let lastOk = true;
	for (const step of chain) {
		const stepResult = reactor.apply(result.event!.issueId, step);
		lastOk = lastOk && stepResult.ok;
	}
	return { ok: lastOk, events };
}

test("happy path: opened → review_requested → closed reaches merged", async () => {
	const reactor = makeReactor();
	const issueNum = 100;
	// Step 1: issue opened → triage, route, start.
	await fire(mkGhEvent("opened", issueNum), reactor);
	// Step 2: review_requested → review.
	await fire(mkGhEvent("review_requested", issueNum), reactor);
	// Step 3: closed (treat as merged via the "merge" action chain).
	await fire(mkGhEvent("closed", issueNum), reactor);

	const history = reactor.machines.get(`SuarezPM/Apohara#${issueNum}`)!;
	expect(history[history.length - 1]).toBe("merged");
	expect(history).toEqual(["issue_opened", "triaged", "routed", "in_progress", "reviewing", "merged"]);
});

test("all 13 lifecycle states reachable via custom action chains", async () => {
	const reactor = makeReactor();

	// Issue A: linear happy path through the canonical 6 states.
	await fire(mkGhEvent("opened", 1), reactor, ["triage", "route", "start", "review", "merge"]);

	// Issue B: opened → closed directly.
	await fire(mkGhEvent("opened", 2), reactor, ["close"]);

	// Issue C: opened → stale.
	await fire(mkGhEvent("opened", 3), reactor, ["mark_stale"]);

	// Issue D: opened → rejected.
	await fire(mkGhEvent("opened", 4), reactor, ["reject"]);

	// Issue E: opened → triage → needs_clarification → triage (round trip).
	await fire(mkGhEvent("opened", 5), reactor, ["triage", "request_clarification", "triage"]);

	// Issue F: opened → triage → route → start → blocked → in_progress.
	await fire(mkGhEvent("opened", 6), reactor, ["triage", "route", "start", "block", "start"]);

	// Issue G: opened → triage → route → escalate → in_progress.
	await fire(mkGhEvent("opened", 7), reactor, ["triage", "route", "escalate", "start"]);

	// Issue H: opened → triage → route → reschedule → route → start.
	await fire(mkGhEvent("opened", 8), reactor, ["triage", "route", "reschedule", "route", "start"]);

	for (const s of ALL_STATES) {
		expect(reactor.visited.has(s)).toBe(true);
	}
});

test("disabled flag short-circuits the whole pipeline", async () => {
	const reactor = makeReactor();
	const events: ReactionTriggerEvent[] = [];
	const result = await dispatchTrigger(
		mkGhEvent("opened", 99),
		(e) => {
			events.push(e);
		},
		{}, // no APOHARA_REACTIONS
	);
	expect(result.dispatched).toBe(false);
	expect(result.skipped).toBe("reactions_disabled");
	// No state machine should have been created.
	expect(reactor.machines.size).toBe(0);
});

test("multiple issues track independent lifecycles", async () => {
	const reactor = makeReactor();
	await fire(mkGhEvent("opened", 10), reactor);
	await fire(mkGhEvent("opened", 11), reactor);
	await fire(mkGhEvent("review_requested", 10), reactor);

	const a = reactor.machines.get("SuarezPM/Apohara#10")!;
	const b = reactor.machines.get("SuarezPM/Apohara#11")!;
	expect(a[a.length - 1]).toBe("reviewing");
	expect(b[b.length - 1]).toBe("in_progress");
});

test("illegal step in chain stops the issue at the last legal state", async () => {
	const reactor = makeReactor();
	// merge directly from issue_opened is illegal (no path through review).
	const result = await fire(mkGhEvent("opened", 20), reactor, ["merge"]);
	expect(result.ok).toBe(false);
	const h = reactor.machines.get("SuarezPM/Apohara#20");
	expect(h).toBeUndefined();
});
