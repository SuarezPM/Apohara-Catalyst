/**
 * TUI agent catalog — declarative metadata for every CLI agent
 * Apohara can host. Lifted from orca's `src/shared/tui-agent-config.ts`
 * (`reference/orca/src/shared/tui-agent-config.ts:1-271`) with the
 * agents pruned to the set Apohara cares about today and the schema
 * trimmed of orca-specific fields (no `draftPasteReadySignal`, no Orca
 * paste-readiness signaling).
 *
 * The catalog is metadata only — it answers "is the binary on PATH?",
 * "how does its prompt go in?", "does it need preflight trust?".
 * Runtime invocation lives in `cli-driver.ts` `BUILTIN_CLI_DRIVERS` and
 * is wired ONLY for agents that expose a real non-interactive mode
 * (headless `--print` / `--prompt`). The rest are catalog entries that
 * future PTY-embedded sessions (T2.1) can launch directly.
 *
 * The 3 ACTIVE providers (`claude-code-cli`, `codex-cli`,
 * `opencode-go`) are also represented here for catalog completeness;
 * their runtime config still lives in `agent-config.ts` with the
 * hook + provider-id fields the router relies on.
 */

export type AgentPromptInjectionMode =
	| "argv"
	| "flag-prompt"
	| "flag-prompt-interactive"
	| "flag-interactive"
	| "stdin-after-start";

export type AgentTrustTarget =
	| "claude"
	| "codex"
	| "cursor"
	| "copilot"
	| "aider";

export interface TuiAgentEntry {
	/** Stable id used by the UI + roster picker. */
	id: string;
	/** Human-readable label for chips / dropdowns. */
	label: string;
	/** Binary name to look up on PATH. */
	detectCmd: string;
	/** What we'd spawn when launching this agent's TUI in a PTY. */
	launchCmd: string;
	/** Argv-vs-stdin-vs-flag pattern for handing it the user's prompt. */
	promptInjectionMode: AgentPromptInjectionMode;
	/** Native "open with text pre-filled" flag (e.g. claude --prefill). */
	draftPromptFlag?: string;
	/** Native "open with text pre-filled" env var (e.g. ORCA_PI_PREFILL). */
	draftPromptEnvVar?: string;
	/** Pre-trust target so the "Do you trust this folder?" dialog never
	 * fires. Routed through `trust-presets.ts::applyTrust()`. */
	preflightTrust?: AgentTrustTarget;
	/** True when this agent has a fully non-interactive mode wired into
	 * `BUILTIN_CLI_DRIVERS` (and so can be `callCliDriver`'d headlessly).
	 * Catalog entries without runtime support can still be PTY-spawned
	 * once T2.1 lands. */
	nonInteractive: boolean;
	/** True when the agent ships as part of the active 3-CLI roster.
	 * Unset entries are LEGACY (`APOHARA_LEGACY_PROVIDERS=1`). */
	active?: boolean;
}

export const TUI_AGENT_CATALOG: TuiAgentEntry[] = [
	// --- Active roster (3 CLI drivers per CLAUDE.md hard rule) ---
	{
		id: "claude-code-cli",
		label: "Claude Code (Anthropic CLI)",
		detectCmd: "claude",
		launchCmd: "claude",
		promptInjectionMode: "argv",
		draftPromptFlag: "--prefill",
		preflightTrust: "claude",
		nonInteractive: true,
		active: true,
	},
	{
		id: "codex-cli",
		label: "Codex (OpenAI CLI)",
		detectCmd: "codex",
		launchCmd: "codex",
		promptInjectionMode: "argv",
		preflightTrust: "codex",
		nonInteractive: true,
		active: true,
	},
	{
		id: "opencode-go",
		label: "opencode (multi-vendor CLI)",
		detectCmd: "opencode",
		launchCmd: "opencode",
		promptInjectionMode: "argv",
		nonInteractive: true,
		active: true,
	},

	// --- Extended (legacy, opt-in via APOHARA_LEGACY_PROVIDERS=1) ---
	{
		id: "gemini-cli",
		label: "Gemini CLI (Google)",
		detectCmd: "gemini",
		launchCmd: "gemini",
		promptInjectionMode: "flag-prompt-interactive",
		nonInteractive: true,
	},
	{
		// `cursor-agent -p <prompt>` runs headless. The first-launch
		// trust menu used to swallow paste — pre-trust closes that.
		id: "cursor-agent",
		label: "Cursor Agent",
		detectCmd: "cursor-agent",
		launchCmd: "cursor-agent",
		promptInjectionMode: "argv",
		preflightTrust: "cursor",
		nonInteractive: true,
	},
	{
		// `copilot --prompt <text>` runs the prompt and exits — that's
		// the headless surface Apohara needs.
		id: "copilot-cli",
		label: "GitHub Copilot CLI",
		detectCmd: "copilot",
		launchCmd: "copilot",
		promptInjectionMode: "flag-prompt",
		preflightTrust: "copilot",
		nonInteractive: true,
	},
	{
		// `aider --message <prompt>` runs the prompt non-interactively
		// (the published `--message` shorthand `-m` works too).
		id: "aider",
		label: "Aider",
		detectCmd: "aider",
		launchCmd: "aider",
		promptInjectionMode: "flag-prompt",
		preflightTrust: "aider",
		nonInteractive: true,
	},
	{
		// Antigravity (Google internal/external): catalog-only for now.
		// The CLI is TUI-first and lacks a documented headless flag.
		id: "antigravity",
		label: "Antigravity (agy)",
		detectCmd: "agy",
		launchCmd: "agy",
		promptInjectionMode: "flag-prompt-interactive",
		nonInteractive: false,
	},
	{
		// xAI Grok CLI. Catalog only — TUI-first.
		id: "grok-cli",
		label: "Grok CLI (xAI)",
		detectCmd: "grok",
		launchCmd: "grok",
		promptInjectionMode: "stdin-after-start",
		nonInteractive: false,
	},
];

const AGENT_BY_ID: Map<string, TuiAgentEntry> = new Map(
	TUI_AGENT_CATALOG.map((entry) => [entry.id, entry]),
);

export function getAgentEntry(id: string): TuiAgentEntry | undefined {
	return AGENT_BY_ID.get(id);
}

export function listAgents(opts?: { activeOnly?: boolean }): TuiAgentEntry[] {
	if (opts?.activeOnly) return TUI_AGENT_CATALOG.filter((a) => a.active);
	return TUI_AGENT_CATALOG;
}
