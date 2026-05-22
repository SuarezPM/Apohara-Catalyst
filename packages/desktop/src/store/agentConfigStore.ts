import { atom } from "jotai/vanilla";

export interface AgentConfigEntry {
  providerId: "claude-code-cli" | "codex-cli" | "opencode-go";
  displayName: string;
  roles: readonly ("planner" | "coder" | "critic" | "judge" | "explorer" | "editor")[];
  capabilities: readonly string[];
  permissions: readonly string[];
  mcpServers: readonly { name: string; status: "connected" | "disconnected" | "error" }[];
  runActive: boolean;
}

export const agentConfigAtom = atom<Record<string, AgentConfigEntry>>({});

export const upsertAgentConfigAtom = atom(null, (get, set, cfg: AgentConfigEntry) => {
  const current = get(agentConfigAtom);
  set(agentConfigAtom, { ...current, [cfg.providerId]: cfg });
});

export const anyRunActiveAtom = atom((get) => {
  return Object.values(get(agentConfigAtom)).some((c) => c.runActive);
});