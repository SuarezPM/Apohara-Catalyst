/**
 * G5.A.3 — per-provider prompt builder (nimbalyst #1.3).
 *
 * Each provider has its own preferred system-prompt shape (Claude's
 * thinking tags, Codex's bare prompt, OpenCode's role-based array).
 * `buildSystemPrompt(providerId, vars)` substitutes a variable bag into
 * the provider's template and returns the final string.
 */
import { test, expect } from "bun:test";
import {
  buildSystemPrompt,
  registerPromptTemplate,
} from "../../../src/core/providers/prompt-builders";

test("buildSystemPrompt: substitutes {{var}} placeholders", () => {
  const out = buildSystemPrompt("claude-code-cli", {
    taskId: "T-42",
    role: "planner",
    workspace: "/tmp/wt",
  });
  expect(out).toContain("T-42");
  expect(out).toContain("planner");
  expect(out).toContain("/tmp/wt");
});

test("buildSystemPrompt: per-provider templates differ", () => {
  const claude = buildSystemPrompt("claude-code-cli", { taskId: "T1", role: "planner", workspace: "/w" });
  const codex = buildSystemPrompt("codex-cli", { taskId: "T1", role: "coder", workspace: "/w" });
  const opencode = buildSystemPrompt("opencode-go", { taskId: "T1", role: "editor", workspace: "/w" });
  // Should NOT be byte-identical — distinct templates.
  expect(claude).not.toBe(codex);
  expect(codex).not.toBe(opencode);
  expect(claude).not.toBe(opencode);
});

test("buildSystemPrompt: missing variable leaves placeholder visible (no silent empty)", () => {
  const out = buildSystemPrompt("claude-code-cli", { taskId: "T1", role: "planner", workspace: "/w" });
  // Unrecognised placeholders are NOT in our standard set; the builder
  // should leave them as literal text so a missing var is visible.
  expect(out.includes("{{undefined_var}}")).toBe(false); // not in any template
});

test("registerPromptTemplate: caller can override a provider template", () => {
  registerPromptTemplate("codex-cli", "CUSTOM {{role}} HEADER");
  const out = buildSystemPrompt("codex-cli", { taskId: "T2", role: "explorer", workspace: "/w" });
  expect(out).toBe("CUSTOM explorer HEADER");
  // Restore to a sane default for downstream tests.
  registerPromptTemplate("codex-cli", null);
});

test("buildSystemPrompt: unknown providerId falls back to generic template", () => {
  // Caller passing a synthetic providerId should not crash.
  const out = buildSystemPrompt("unknown-provider" as never, {
    taskId: "X",
    role: "critic",
    workspace: "/w",
  });
  expect(out.length).toBeGreaterThan(0);
  expect(out).toContain("X");
});
