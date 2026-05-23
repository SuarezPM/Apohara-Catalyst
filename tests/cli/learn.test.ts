/**
 * Tests for `apohara learn <provider>` prompt builder (G5.I.3).
 */
import { describe, expect, test } from "bun:test";
import { buildLearnPrompt } from "../../src/cli/learn";

describe("buildLearnPrompt", () => {
	test("rejects unknown providers", () => {
		expect(() => buildLearnPrompt("gpt-5-cli")).toThrow(/unknown provider/);
	});

	test("rejects unknown providers when custom roster is provided", () => {
		expect(() =>
			buildLearnPrompt("claude-code-cli", { allowedProviders: ["codex-cli"] }),
		).toThrow(/unknown provider/);
	});

	test("builds a prompt for claude-code-cli", () => {
		const out = buildLearnPrompt("claude-code-cli");
		expect(out).toContain("# Learn Apohara");
		expect(out).toContain("`claude-code-cli`");
		expect(out).toContain("primary coding agent");
	});

	test("builds a prompt for codex-cli with the critic role", () => {
		const out = buildLearnPrompt("codex-cli");
		expect(out).toContain("`codex-cli`");
		expect(out).toContain("secondary critic");
	});

	test("builds a prompt for opencode-go with the background-builder role", () => {
		const out = buildLearnPrompt("opencode-go");
		expect(out).toContain("`opencode-go`");
		expect(out).toContain("background workspace builder");
	});

	test("includes all four sections in order", () => {
		const out = buildLearnPrompt("claude-code-cli");
		const idx1 = out.indexOf("## 1. Introduction");
		const idx2 = out.indexOf("## 2. Key files");
		const idx3 = out.indexOf("## 3. Common workflows");
		const idx4 = out.indexOf("## 4. Escalation paths");
		expect(idx1).toBeGreaterThan(0);
		expect(idx2).toBeGreaterThan(idx1);
		expect(idx3).toBeGreaterThan(idx2);
		expect(idx4).toBeGreaterThan(idx3);
	});

	test("references CLAUDE.md and design spec by path", () => {
		const out = buildLearnPrompt("claude-code-cli");
		expect(out).toContain("CLAUDE.md");
		expect(out).toContain("docs/superpowers/specs/");
		expect(out).toContain("docs/superpowers/plans/");
	});

	test("includes the provider's hook config path", () => {
		const out = buildLearnPrompt("opencode-go");
		expect(out).toContain("opencode.jsonc");
	});

	test("escalation section lists irreversible-action examples", () => {
		const out = buildLearnPrompt("claude-code-cli");
		expect(out).toContain("force push");
		expect(out).toContain("rm -rf");
	});

	test("explicitly bans `git add .`", () => {
		const out = buildLearnPrompt("claude-code-cli");
		expect(out).toContain("git add .");
	});

	test("respects custom projectName", () => {
		const out = buildLearnPrompt("claude-code-cli", {
			projectName: "ApoharaUltimate",
		});
		expect(out).toContain("ApoharaUltimate");
	});

	test("deterministic — same inputs produce same output", () => {
		const a = buildLearnPrompt("claude-code-cli");
		const b = buildLearnPrompt("claude-code-cli");
		expect(a).toBe(b);
	});
});
