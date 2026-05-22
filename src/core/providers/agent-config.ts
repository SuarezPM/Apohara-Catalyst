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
  preflightTrust?:
    | "claude"
    | "codex"
    | "cursor"
    | "copilot"
    | "aider"
    | null;
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
    // `opencode run --format json <prompt>` is the non-interactive
    // CLI entry point. The previous `--pure` flag never existed
    // upstream; we were spawning the binary with an unknown arg.
    args: ["run", "--format", "json"],
    promptInjectionMode: "argv",
    draftPromptFlag: null,
    draftPromptEnvVar: null,
    draftPasteReadySignal: null,
    preflightTrust: null,
    // Per upstream config discovery (`reference/opencode/packages/
    // opencode/src/config/config.ts:340`), opencode reads its config
    // from the workspace root file `opencode.jsonc` first, then
    // `$XDG_CONFIG_HOME/opencode/opencode.{json,jsonc}`. The previous
    // `~/.opencode/settings.json` path is not in the lookup chain.
    hookConfigPath: "~/.config/opencode/opencode.jsonc",
    hookConfigShape: "json",
    hookScriptName: "apohara-opencode-hook",
    verifiedAgainst: "opencode (Bun) 1.15.x",
  },
};

export function getAgentConfig(id: ProviderId): AgentConfig | undefined {
  return AGENT_CONFIG[id];
}