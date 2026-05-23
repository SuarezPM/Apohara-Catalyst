import { test, expect } from "bun:test";
import {
	canonicalIssueId,
	dispatchTrigger,
	isReactionsEnabled,
	mapToTrigger,
	type GitHubIssueEvent,
	type ReactionTriggerEvent,
} from "../../../packages/github-bridge/src/reaction-trigger";

function mkEvent(
	overrides: Partial<GitHubIssueEvent> = {},
): GitHubIssueEvent {
	return {
		action: "opened",
		issue: { number: 42, title: "hello", state: "open" },
		repository: { full_name: "SuarezPM/Apohara" },
		...overrides,
	};
}

test("isReactionsEnabled gated by APOHARA_REACTIONS=1", () => {
	expect(isReactionsEnabled({})).toBe(false);
	expect(isReactionsEnabled({ APOHARA_REACTIONS: "0" })).toBe(false);
	expect(isReactionsEnabled({ APOHARA_REACTIONS: "1" })).toBe(true);
});

test("canonical issue id format", () => {
	expect(canonicalIssueId(mkEvent())).toBe("SuarezPM/Apohara#42");
});

test("mapToTrigger maps known actions", () => {
	const cases: { action: GitHubIssueEvent["action"]; trigger: string }[] = [
		{ action: "opened", trigger: "issue_opened" },
		{ action: "reopened", trigger: "issue_reopened" },
		{ action: "closed", trigger: "issue_closed" },
		{ action: "labeled", trigger: "issue_labeled" },
		{ action: "review_requested", trigger: "review_requested" },
	];
	for (const c of cases) {
		const got = mapToTrigger(mkEvent({ action: c.action }));
		expect(got?.trigger).toBe(c.trigger);
	}
});

test("mapToTrigger returns null for unmapped actions", () => {
	expect(mapToTrigger(mkEvent({ action: "edited" }))).toBeNull();
});

test("dispatchTrigger skips when flag off", async () => {
	let called = 0;
	const result = await dispatchTrigger(mkEvent(), () => {
		called++;
	}, {});
	expect(result.dispatched).toBe(false);
	expect(result.skipped).toBe("reactions_disabled");
	expect(called).toBe(0);
});

test("dispatchTrigger skips unmapped actions", async () => {
	let called = 0;
	const result = await dispatchTrigger(mkEvent({ action: "edited" }), () => {
		called++;
	}, { APOHARA_REACTIONS: "1" });
	expect(result.dispatched).toBe(false);
	expect(result.skipped).toBe("unmapped_action");
	expect(called).toBe(0);
});

test("dispatchTrigger fires and awaits async dispatch", async () => {
	const events: ReactionTriggerEvent[] = [];
	const result = await dispatchTrigger(
		mkEvent(),
		async (e) => {
			await new Promise((r) => setTimeout(r, 1));
			events.push(e);
		},
		{ APOHARA_REACTIONS: "1" },
	);
	expect(result.dispatched).toBe(true);
	expect(events).toHaveLength(1);
	expect(events[0].trigger).toBe("issue_opened");
	expect(events[0].issueId).toBe("SuarezPM/Apohara#42");
	expect(events[0].source).toBe("github");
});

test("dispatchTrigger forwards original action", async () => {
	let received: ReactionTriggerEvent | undefined;
	await dispatchTrigger(
		mkEvent({ action: "review_requested" }),
		(e) => {
			received = e;
		},
		{ APOHARA_REACTIONS: "1" },
	);
	expect(received?.originalAction).toBe("review_requested");
});
