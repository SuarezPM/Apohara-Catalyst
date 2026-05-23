/**
 * G5.C.1 — Pre/PostCompact contract re-injection (claude-octopus #8).
 *
 * Before the agent compacts its context window, we snapshot the load-bearing
 * "contract" (config, settings, plan IDs, active task state). After the
 * compaction the snapshot is re-injected into the agent's next prompt as
 * `additionalContext` so the post-compact agent still knows the rules.
 */
import { describe, expect, it, beforeEach } from "bun:test";
import { CompactReinjector, type ContractSnapshot } from "./compact-reinjection.js";

describe("CompactReinjector", () => {
	let reinjector: CompactReinjector;

	beforeEach(() => {
		reinjector = new CompactReinjector();
	});

	it("returns null when no snapshot is captured", () => {
		expect(reinjector.consume("session-1")).toBeNull();
	});

	it("captures pre_compact then yields snapshot on post_compact", () => {
		const snapshot: ContractSnapshot = {
			sessionId: "session-1",
			capturedAt: 100,
			activePlanIds: ["plan-1", "plan-2"],
			activeTaskId: "task-9",
			settings: { trustPreset: "balanced" },
			notes: "drift probe armed",
		};
		reinjector.capture(snapshot);
		const out = reinjector.consume("session-1");
		expect(out).not.toBeNull();
		expect(out?.activePlanIds).toEqual(["plan-1", "plan-2"]);
		// consume is destructive — must not double-yield
		expect(reinjector.consume("session-1")).toBeNull();
	});

	it("isolates snapshots per session", () => {
		reinjector.capture({
			sessionId: "s-a",
			capturedAt: 1,
			activePlanIds: ["a"],
			activeTaskId: null,
			settings: {},
		});
		reinjector.capture({
			sessionId: "s-b",
			capturedAt: 2,
			activePlanIds: ["b"],
			activeTaskId: null,
			settings: {},
		});
		expect(reinjector.consume("s-a")?.activePlanIds).toEqual(["a"]);
		expect(reinjector.consume("s-b")?.activePlanIds).toEqual(["b"]);
	});

	it("overwrites snapshot if pre_compact fires twice without consume", () => {
		reinjector.capture({
			sessionId: "s",
			capturedAt: 1,
			activePlanIds: ["v1"],
			activeTaskId: null,
			settings: {},
		});
		reinjector.capture({
			sessionId: "s",
			capturedAt: 2,
			activePlanIds: ["v2"],
			activeTaskId: null,
			settings: {},
		});
		expect(reinjector.consume("s")?.activePlanIds).toEqual(["v2"]);
	});

	it("renders snapshot as additionalContext JSON envelope", () => {
		reinjector.capture({
			sessionId: "s",
			capturedAt: 42,
			activePlanIds: ["plan-x"],
			activeTaskId: "task-y",
			settings: { trustPreset: "strict" },
			notes: "post-compact reload required",
		});
		const envelope = reinjector.renderAdditionalContext("s");
		expect(envelope).not.toBeNull();
		expect(envelope?.additionalContext).toBeTypeOf("string");
		// Contract bits must be present in the rendered string
		expect(envelope?.additionalContext).toContain("plan-x");
		expect(envelope?.additionalContext).toContain("task-y");
		expect(envelope?.additionalContext).toContain("strict");
		// Rendering is destructive (it consumes the snapshot)
		expect(reinjector.consume("s")).toBeNull();
	});

	it("returns null envelope when no snapshot exists", () => {
		expect(reinjector.renderAdditionalContext("missing")).toBeNull();
	});

	it("handles hook events: pre_compact captures, post_compact re-injects", () => {
		const pre = reinjector.onHookEvent({
			type: "pre_compact",
			sessionId: "session-x",
			contract: {
				activePlanIds: ["p1"],
				activeTaskId: "t1",
				settings: { mode: "gpu" },
			},
			timestamp: 100,
		});
		expect(pre.action).toBe("captured");

		const post = reinjector.onHookEvent({
			type: "post_compact",
			sessionId: "session-x",
			timestamp: 200,
		});
		expect(post.action).toBe("reinjected");
		if (post.action !== "reinjected") throw new Error("unreachable");
		expect(post.additionalContext).toContain("p1");
		expect(post.additionalContext).toContain("t1");
	});

	it("post_compact with no prior pre_compact returns noop", () => {
		const post = reinjector.onHookEvent({
			type: "post_compact",
			sessionId: "missing",
			timestamp: 1,
		});
		expect(post.action).toBe("noop");
	});

	it("ignores unrelated hook event types", () => {
		const out = reinjector.onHookEvent({
			type: "pre_tool_use",
			sessionId: "s",
			timestamp: 1,
		} as never);
		expect(out.action).toBe("ignored");
	});
});
