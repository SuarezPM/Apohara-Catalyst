import { expect, test } from "bun:test";
import {
	getAgentEntry,
	listAgents,
	TUI_AGENT_CATALOG,
} from "../../../src/core/providers/tui-agent-config";

test("catalog includes the 3 active CLI drivers", () => {
	const ids = TUI_AGENT_CATALOG.map((a) => a.id);
	expect(ids).toContain("claude-code-cli");
	expect(ids).toContain("codex-cli");
	expect(ids).toContain("opencode-go");
});

test("active-only listing returns the 3 active providers", () => {
	const active = listAgents({ activeOnly: true });
	const ids = active.map((a) => a.id).sort();
	expect(ids).toEqual(["claude-code-cli", "codex-cli", "opencode-go"]);
});

test("getAgentEntry returns full record for known ids", () => {
	const claude = getAgentEntry("claude-code-cli");
	expect(claude?.detectCmd).toBe("claude");
	expect(claude?.draftPromptFlag).toBe("--prefill");
	expect(claude?.preflightTrust).toBe("claude");
	expect(claude?.active).toBe(true);

	const cursor = getAgentEntry("cursor-agent");
	expect(cursor?.preflightTrust).toBe("cursor");
	expect(cursor?.nonInteractive).toBe(true);
	expect(cursor?.active).toBeUndefined();
});

test("getAgentEntry returns undefined for unknown id", () => {
	expect(getAgentEntry("definitely-not-a-real-cli")).toBeUndefined();
});

test("non-interactive flag matches which agents have CLI driver entries", () => {
	// The IDs that report `nonInteractive: true` must also appear in
	// the BUILTIN_CLI_DRIVERS so a future `callCliDriver(id, ...)`
	// invocation actually works (catalog and runtime stay in sync).
	const nonInteractive = TUI_AGENT_CATALOG.filter((a) => a.nonInteractive).map(
		(a) => a.id,
	);
	expect(nonInteractive.sort()).toEqual(
		[
			"aider",
			"claude-code-cli",
			"codex-cli",
			"copilot-cli",
			"cursor-agent",
			"gemini-cli",
			"opencode-go",
		].sort(),
	);
});
