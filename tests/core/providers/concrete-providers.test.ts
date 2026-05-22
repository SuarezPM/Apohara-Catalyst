import { test, expect, beforeEach } from "bun:test";
import { ClaudeCodeProvider } from "../../../src/core/providers/ClaudeCodeProvider";
import { CodexProvider } from "../../../src/core/providers/CodexProvider";
import { OpenCodeProvider } from "../../../src/core/providers/OpenCodeProvider";
import { setApoharaDeps, resetApoharaDeps } from "../../../src/core/providers/deps";

beforeEach(() => {
  resetApoharaDeps();
  setApoharaDeps({
    hookEndpoint: () => ({ port: 8901, token: "t" }),
    indexerSocketPath: "/tmp/i", ledgerPath: "/tmp/l", capabilityStatsPath: "/tmp/c",
  });
});

test("ClaudeCodeProvider id is 'claude-code-cli'", () => {
  expect(new ClaudeCodeProvider().id).toBe("claude-code-cli");
});

test("CodexProvider id is 'codex-cli'", () => {
  expect(new CodexProvider().id).toBe("codex-cli");
});

test("OpenCodeProvider id is 'opencode-go'", () => {
  expect(new OpenCodeProvider().id).toBe("opencode-go");
});

test("ClaudeCodeProvider roles include 'planner' and 'critic'", () => {
  expect(new ClaudeCodeProvider().roles).toContain("planner");
  expect(new ClaudeCodeProvider().roles).toContain("critic");
});

test("CodexProvider role is 'coder'", () => {
  expect(new CodexProvider().roles).toContain("coder");
});

test("OpenCodeProvider roles include 'explorer' and 'editor'", () => {
  expect(new OpenCodeProvider().roles).toContain("explorer");
  expect(new OpenCodeProvider().roles).toContain("editor");
});