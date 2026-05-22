import { test, expect } from "bun:test";
import { AGENT_CONFIG, getAgentConfig, type ProviderId } from "../../../src/core/providers/agent-config";

test("AGENT_CONFIG contains exactly the 3 active providers", () => {
  const ids = Object.keys(AGENT_CONFIG);
  expect(ids.sort()).toEqual(["claude-code-cli", "codex-cli", "opencode-go"]);
});

test("each config has required fields", () => {
  for (const id of Object.keys(AGENT_CONFIG) as ProviderId[]) {
    const cfg = AGENT_CONFIG[id];
    expect(typeof cfg.binary).toBe("string");
    expect(typeof cfg.promptInjectionMode).toBe("string");
    expect(typeof cfg.hookConfigPath).toBe("string");
    expect(typeof cfg.hookConfigShape).toBe("string");
    expect(typeof cfg.hookScriptName).toBe("string");
  }
});

test("claude-code-cli has preflightTrust='claude'", () => {
  expect(AGENT_CONFIG["claude-code-cli"].preflightTrust).toBe("claude");
});

test("opencode-go uses 'run --format json' (NDJSON streaming)", () => {
  // Replaced the bogus `--pure` flag (never existed upstream) with the
  // real non-interactive invocation per opencode 1.15.x.
  expect(AGENT_CONFIG["opencode-go"].args).toEqual(["run", "--format", "json"]);
});

test("getAgentConfig returns undefined for unknown provider", () => {
  expect(getAgentConfig("nope" as ProviderId)).toBeUndefined();
});