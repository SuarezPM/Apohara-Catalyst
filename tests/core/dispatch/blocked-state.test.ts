/**
 * Symphony hallazgo 10 → Blocked as primary state (G5.B.3).
 *
 * Goal: the runtime can take a "permission_request" / "approval_required"
 * style event from a CLI provider and classify it into one of the 5
 * BlockedReason variants, plus produce a BlockedSnapshot we can store
 * alongside the task and later surface in the Blocked / Needs Operator
 * UI column.
 *
 *   BlockedReason = approval_required
 *                 | user_input_required
 *                 | mcp_elicitation
 *                 | stalled_after_input_request
 *                 | provider_rejected
 *
 * The classifier is heuristic — labels + event type — and only
 * triggers from explicit signals. False positives are louder than
 * false negatives here (we'd rather miss a block than mis-label a
 * normal completion as approval_required and freeze the queue).
 */
import { expect, test } from "bun:test";
import {
	classifyBlocked,
	type BlockedReason,
	type BlockedSnapshot,
} from "../../../src/core/dispatch/state";

test("classifyBlocked: explicit approval_required event", () => {
	const r = classifyBlocked({ kind: "permission_request", label: "Approve write" });
	expect(r?.reason).toBe("approval_required");
});

test("classifyBlocked: user_input_required from prompt label", () => {
	const r = classifyBlocked({
		kind: "user_input_required",
		label: "Please paste the API key",
	});
	expect(r?.reason).toBe("user_input_required");
});

test("classifyBlocked: mcp_elicitation from elicitation kind", () => {
	const r = classifyBlocked({ kind: "elicitation", label: "tool needs spec" });
	expect(r?.reason).toBe("mcp_elicitation");
});

test("classifyBlocked: provider_rejected from rejection kind", () => {
	const r = classifyBlocked({ kind: "provider_rejected", reason: "rate-limited" });
	expect(r?.reason).toBe("provider_rejected");
});

test("classifyBlocked: stalled_after_input_request from stall + prior input request", () => {
	const r = classifyBlocked({
		kind: "stall",
		priorInputRequestAt: Date.now() - 5_000,
	});
	expect(r?.reason).toBe("stalled_after_input_request");
});

test("classifyBlocked: stall WITHOUT prior input request returns null", () => {
	const r = classifyBlocked({ kind: "stall" });
	expect(r).toBeNull();
});

test("classifyBlocked: arbitrary event returns null (false-neg over false-pos)", () => {
	// biome-ignore lint/suspicious/noExplicitAny: deliberate misc event
	const r = classifyBlocked({ kind: "tool_call_start" as any });
	expect(r).toBeNull();
});

test("BlockedSnapshot carries provenance fields", () => {
	const snap: BlockedSnapshot = {
		reason: "approval_required",
		since: Date.now(),
		detail: "tool=Bash command=rm -rf",
	};
	expect(snap.reason).toBe<BlockedReason>("approval_required");
	expect(typeof snap.since).toBe("number");
});
