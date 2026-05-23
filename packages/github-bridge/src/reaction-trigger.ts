/**
 * GitHub → reaction-engine trigger bridge (G6.D.11).
 *
 * Tap into the github-bridge hook surface: when an issue event is
 * received (opened, reopened, labelled, closed, review_requested, ...),
 * convert it into a `ReactionTriggerEvent` and dispatch it to the
 * reactor sidecar via the provided dispatch function (typically an mpsc
 * sender bridged from the Rust daemon).
 *
 * Pure mapping logic — no IPC, no fetch. Tests pass in a fake dispatch.
 *
 * Feature flag: `APOHARA_REACTIONS=1`. When OFF, `dispatchTrigger`
 * is a no-op (returns `{ skipped: "reactions_disabled" }`).
 */

export type GitHubIssueAction =
	| "opened"
	| "reopened"
	| "closed"
	| "edited"
	| "labeled"
	| "unlabeled"
	| "assigned"
	| "unassigned"
	| "review_requested"
	| "milestoned"
	| "demilestoned";

export interface GitHubIssueEvent {
	action: GitHubIssueAction;
	issue: {
		number: number;
		title: string;
		labels?: string[];
		state?: "open" | "closed";
	};
	repository: { full_name: string };
}

export interface ReactionTriggerEvent {
	issueId: string; // canonical id: "<owner>/<repo>#<number>"
	trigger: string; // mapped trigger name (snake_case) for reactions.conf
	source: "github";
	originalAction: GitHubIssueAction;
}

export type ReactionDispatchFn = (
	evt: ReactionTriggerEvent,
) => Promise<void> | void;

export interface DispatchResult {
	dispatched: boolean;
	skipped?: "reactions_disabled" | "unmapped_action";
	event?: ReactionTriggerEvent;
}

const ACTION_TO_TRIGGER: Readonly<Partial<Record<GitHubIssueAction, string>>> = {
	opened: "issue_opened",
	reopened: "issue_reopened",
	closed: "issue_closed",
	labeled: "issue_labeled",
	review_requested: "review_requested",
	assigned: "issue_assigned",
	milestoned: "issue_milestoned",
};

export function isReactionsEnabled(
	env: Record<string, string | undefined> = process.env,
): boolean {
	return env.APOHARA_REACTIONS === "1";
}

export function canonicalIssueId(event: GitHubIssueEvent): string {
	return `${event.repository.full_name}#${event.issue.number}`;
}

export function mapToTrigger(event: GitHubIssueEvent): ReactionTriggerEvent | null {
	const trigger = ACTION_TO_TRIGGER[event.action];
	if (!trigger) return null;
	return {
		issueId: canonicalIssueId(event),
		trigger,
		source: "github",
		originalAction: event.action,
	};
}

export async function dispatchTrigger(
	event: GitHubIssueEvent,
	dispatch: ReactionDispatchFn,
	env: Record<string, string | undefined> = process.env,
): Promise<DispatchResult> {
	if (!isReactionsEnabled(env)) {
		return { dispatched: false, skipped: "reactions_disabled" };
	}
	const mapped = mapToTrigger(event);
	if (!mapped) {
		return { dispatched: false, skipped: "unmapped_action" };
	}
	await dispatch(mapped);
	return { dispatched: true, event: mapped };
}
