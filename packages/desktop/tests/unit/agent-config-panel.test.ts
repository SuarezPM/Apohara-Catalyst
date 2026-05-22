import { test, expect } from "bun:test";
import { createStore } from "jotai/vanilla";
import { agentConfigAtom, anyRunActiveAtom, upsertAgentConfigAtom, type AgentConfigEntry } from "../../src/store/agentConfigStore.js";

function cfg(over: Partial<AgentConfigEntry>): AgentConfigEntry {
  return {
    providerId: "claude-code-cli",
    displayName: "Claude",
    roles: ["coder"],
    capabilities: [],
    permissions: [],
    mcpServers: [],
    runActive: false,
    ...over,
  };
}

test("empty start", () => {
  const s = createStore();
  expect(Object.keys(s.get(agentConfigAtom)).length).toBe(0);
});

test("upsert + lookup", () => {
  const s = createStore();
  s.set(upsertAgentConfigAtom, cfg({ providerId: "codex-cli", displayName: "Codex" }));
  expect(s.get(agentConfigAtom)["codex-cli"].displayName).toBe("Codex");
});

test("anyRunActiveAtom is false when all run_active=false", () => {
  const s = createStore();
  s.set(upsertAgentConfigAtom, cfg());
  expect(s.get(anyRunActiveAtom)).toBe(false);
});

test("anyRunActiveAtom is true when any run_active", () => {
  const s = createStore();
  s.set(upsertAgentConfigAtom, cfg({ providerId: "claude-code-cli", runActive: true }));
  s.set(upsertAgentConfigAtom, cfg({ providerId: "codex-cli", runActive: false }));
  expect(s.get(anyRunActiveAtom)).toBe(true);
});