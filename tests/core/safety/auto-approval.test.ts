/**
 * Tests for the auto-approval heuristic (symphony #9, G5.G.6).
 *
 * The heuristic answers a single question: given a tool call, can it be
 * approved automatically without prompting the user?
 *
 * The answer is a `{ decision: "allow" | "prompt" | "deny", reason }`
 * triple. The default-deny posture means anything we do NOT positively
 * identify as cheap-and-safe falls through to "prompt".
 */

import { test, expect, describe } from "bun:test";
import {
	classifyToolForAutoApproval,
	type ToolCall,
	type AutoApprovalDecision,
} from "../../../src/core/safety/auto-approval";

function call(tool: string, input: Record<string, unknown> = {}): ToolCall {
	return { tool, input };
}

describe("auto-approval: read-only tools", () => {
	test("Read is auto-allowed", () => {
		const r = classifyToolForAutoApproval(call("Read", { file_path: "/x" }));
		expect(r.decision).toBe("allow");
		expect(r.reason).toContain("read-only");
	});

	test("Glob is auto-allowed", () => {
		expect(classifyToolForAutoApproval(call("Glob")).decision).toBe("allow");
	});

	test("Grep is auto-allowed", () => {
		expect(classifyToolForAutoApproval(call("Grep")).decision).toBe("allow");
	});

	test("LS is auto-allowed", () => {
		expect(classifyToolForAutoApproval(call("LS")).decision).toBe("allow");
	});
});

describe("auto-approval: safe Bash commands", () => {
	test("`ls -la` is allowed", () => {
		const r = classifyToolForAutoApproval(call("Bash", { command: "ls -la" }));
		expect(r.decision).toBe("allow");
	});

	test("`pwd` is allowed", () => {
		expect(classifyToolForAutoApproval(call("Bash", { command: "pwd" })).decision).toBe("allow");
	});

	test("`git status` is allowed", () => {
		expect(
			classifyToolForAutoApproval(call("Bash", { command: "git status" })).decision,
		).toBe("allow");
	});

	test("`git log --oneline -10` is allowed", () => {
		expect(
			classifyToolForAutoApproval(call("Bash", { command: "git log --oneline -10" }))
				.decision,
		).toBe("allow");
	});

	test("`cat package.json` is allowed", () => {
		expect(
			classifyToolForAutoApproval(call("Bash", { command: "cat package.json" })).decision,
		).toBe("allow");
	});
});

describe("auto-approval: unsafe Bash commands fall to prompt", () => {
	test("`rm -rf x` requires prompt", () => {
		const r = classifyToolForAutoApproval(call("Bash", { command: "rm -rf /tmp/x" }));
		expect(r.decision).toBe("prompt");
		expect(r.reason).toContain("destructive");
	});

	test("`sudo apt install` requires prompt", () => {
		expect(
			classifyToolForAutoApproval(call("Bash", { command: "sudo apt install foo" }))
				.decision,
		).toBe("prompt");
	});

	test("`git push` requires prompt (remote-mutating)", () => {
		expect(
			classifyToolForAutoApproval(call("Bash", { command: "git push origin main" }))
				.decision,
		).toBe("prompt");
	});

	test("`curl https://...` requires prompt (network egress)", () => {
		expect(
			classifyToolForAutoApproval(call("Bash", { command: "curl https://example.com" }))
				.decision,
		).toBe("prompt");
	});

	test("compound command with one unsafe leg requires prompt", () => {
		const r = classifyToolForAutoApproval(
			call("Bash", { command: "ls -la && rm -rf /tmp/x" }),
		);
		expect(r.decision).toBe("prompt");
	});
});

describe("auto-approval: mutating tools require prompt", () => {
	test("Write requires prompt", () => {
		expect(classifyToolForAutoApproval(call("Write")).decision).toBe("prompt");
	});

	test("Edit requires prompt", () => {
		expect(classifyToolForAutoApproval(call("Edit")).decision).toBe("prompt");
	});

	test("WebFetch / WebSearch require prompt (network egress)", () => {
		expect(classifyToolForAutoApproval(call("WebFetch")).decision).toBe("prompt");
		expect(classifyToolForAutoApproval(call("WebSearch")).decision).toBe("prompt");
	});
});

describe("auto-approval: unknown tool defaults to prompt", () => {
	test("unrecognized tool name → prompt", () => {
		const r = classifyToolForAutoApproval(call("InventedNewTool"));
		expect(r.decision).toBe("prompt");
		expect(r.reason).toContain("unknown");
	});
});

describe("auto-approval: result shape", () => {
	test("decision is one of the three enum values", () => {
		const cases = ["Read", "Bash", "rm -rf /", "Edit", "InventedTool"];
		for (const c of cases) {
			const r: AutoApprovalDecision = classifyToolForAutoApproval(call(c, { command: c }));
			expect(["allow", "prompt", "deny"]).toContain(r.decision);
			expect(typeof r.reason).toBe("string");
		}
	});

	test("empty Bash command is denied (suspicious)", () => {
		const r = classifyToolForAutoApproval(call("Bash", { command: "" }));
		expect(r.decision).toBe("prompt");
	});
});
