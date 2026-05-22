/**
 * TUI_AGENT_CONFIG matrix per spec §4.5 (orca #2 inspiration).
 *
 * Declarative per-provider config: binary, prompt injection mode, draft flag,
 * preflight trust strategy, hook config path/shape, hook script name. UI and
 * spawn logic both read from this — never hardcode provider names elsewhere.
 */

export type ProviderId = "claude-code-cli" | "codex-cli" | "opencode-go";

export type PromptInjectionMode =
  | "argv"
  | "flag-prompt"
  | "flag-prompt-interactive"
  | "flag-interactive"
  | "stdin-after-start";

export type HookConfigShape = "json" | "toml";

export interface AgentConfig {
  binary: string;
  args?: string[];
  promptInjectionMode: PromptInjectionMode;
  draftPromptFlag?: string | null;
  draftPromptEnvVar?: string | null;
  draftPasteReadySignal?: string | null;
  preflightTrust?: "claude" | "codex" | null;
  hookConfigPath: string;
  hookConfigShape: HookConfigShape;
  hookScriptName: string;
  verifiedAgainst?: string;
}

export const AGENT_CONFIG: Record<ProviderId, AgentConfig> = {
  "claude-code-cli": {
    binary: "claude",
    promptInjectionMode: "argv",
    draftPromptFlag: "--prefill",
    draftPromptEnvVar: null,
    draftPasteReadySignal: "PromptReady",
    preflightTrust: "claude",
    hookConfigPath: "~/.claude/settings.json",
    hookConfigShape: "json",
    hookScriptName: "apohara-claude-hook",
    verifiedAgainst: "claude 1.4.x",
  },
  "codex-cli": {
    binary: "codex",
    promptInjectionMode: "flag-prompt-interactive",
    draftPromptFlag: null,
    draftPromptEnvVar: null,
    draftPasteReadySignal: null,
    preflightTrust: "codex",
    hookConfigPath: "~/.codex/config.toml",
    hookConfigShape: "toml",
    hookScriptName: "apohara-codex-hook",
    verifiedAgainst: "codex 0.5.x",
  },
  "opencode-go": {
    binary: "opencode",
    args: ["--pure"],
    promptInjectionMode: "stdin-after-start",
    draftPromptFlag: null,
    draftPromptEnvVar: null,
    draftPasteReadySignal: null,
    preflightTrust: null,
    hookConfigPath: "~/.opencode/settings.json",
    hookConfigShape: "json",
    hookScriptName: "apohara-opencode-hook",
    verifiedAgainst: "opencode (Bun) latest",
  },
};

export function getAgentConfig(id: ProviderId): AgentConfig | undefined {
  return AGENT_CONFIG[id];
}