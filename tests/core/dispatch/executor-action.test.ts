import { expect, test } from "bun:test";
import {
	actionChain,
	appendAction,
	startWorkspace,
	type ExecutorAction,
} from "../../../src/core/dispatch/executor-action";

test("startWorkspace builds a single-coding chain by default", () => {
	const chain = startWorkspace({
		prompt: "do the thing",
		providerId: "claude-code-cli",
	});
	expect(chain.kind).toBe("coding");
	expect(actionChain(chain)).toHaveLength(1);
});

test("appendAction walks to the rightmost leaf", () => {
	const a: ExecutorAction = {
		kind: "coding",
		prompt: "p1",
		providerId: "claude-code-cli",
	};
	const b: ExecutorAction = {
		kind: "review",
		criteria: ["lint", "tests"],
	};
	const c: ExecutorAction = {
		kind: "script",
		command: "echo",
		args: ["ok"],
	};
	appendAction(a, b);
	appendAction(a, c);
	const chain = actionChain(a);
	expect(chain.map((n) => n.kind)).toEqual(["coding", "review", "script"]);
});

test("actionChain returns single-element array for a leaf", () => {
	const leaf: ExecutorAction = {
		kind: "coding",
		prompt: "p",
		providerId: "codex-cli",
	};
	expect(actionChain(leaf)).toEqual([leaf]);
});
