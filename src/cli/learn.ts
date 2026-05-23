/**
 * `apohara learn <provider>` — self-teaching prompt builder (G5.I.3).
 *
 * culture's `learn_prompt` flow: when a fresh coding-agent session attaches
 * to a repo it doesn't know, it asks Apohara for a tailored onboarding
 * brief that points at the real files + workflows + escalation paths
 * instead of asking the user to copy-paste CLAUDE.md.
 *
 * This module's only public surface is `buildLearnPrompt(provider, ctx?)`.
 * It returns a deterministic Markdown string assembled from four sections:
 *
 *   1. Introduction — what Apohara is, what role the agent plays.
 *   2. Key files — paths the agent should read first (provider-aware).
 *   3. Common workflows — concrete invocations + expected outcomes.
 *   4. Escalation paths — when to stop and ask the human.
 *
 * Side-effect-free; safe to call from `src/cli.ts` or directly from tests.
 * Validates the provider against the active roster — typos are flagged
 * inline so the user gets immediate feedback instead of a broken prompt.
 */

import type { ProviderId } from "../core/providers/agent-config";
import { AGENT_CONFIG } from "../core/providers/agent-config";

export interface BuildLearnPromptOptions {
	/** Optional override for the project name used in headings. */
	projectName?: string;
	/** Optional roster of provider ids to validate against. Default: active 3. */
	allowedProviders?: readonly string[];
}

const DEFAULT_PROVIDERS: readonly string[] = [
	"claude-code-cli",
	"codex-cli",
	"opencode-go",
];

/**
 * Validate `provider` against the allowed roster.
 * Throws with a helpful message listing valid ids.
 */
function assertProvider(
	provider: string,
	allowed: readonly string[],
): asserts provider is ProviderId {
	if (!allowed.includes(provider)) {
		throw new Error(
			`unknown provider "${provider}" — expected one of: ${allowed.join(", ")}`,
		);
	}
}

function introductionSection(provider: ProviderId, projectName: string): string {
	const role =
		provider === "claude-code-cli"
			? "primary coding agent"
			: provider === "codex-cli"
				? "secondary critic / code-review agent"
				: "background workspace builder";
	return [
		`## 1. Introduction`,
		``,
		`You are running inside **${projectName}**, a multi-agent orchestrator that wraps coding CLIs.`,
		`Your provider id is \`${provider}\` and your typical role here is **${role}**.`,
		`Apohara never owns your API key — it shells out to your authenticated CLI session, so anything you can normally do in \`${AGENT_CONFIG[provider]?.binary}\` you can do here.`,
		``,
	].join("\n");
}

function keyFilesSection(provider: ProviderId): string {
	const cfg = AGENT_CONFIG[provider];
	const lines = [
		`## 2. Key files`,
		``,
		`Read these in order before you change anything:`,
		``,
		`- \`CLAUDE.md\` — engineering contract + past-incident rules. Load-bearing.`,
		`- \`docs/superpowers/specs/2026-05-21-apohara-v1-design.md\` — design spec, cross-cutting disciplines §0.`,
		`- \`docs/superpowers/plans/2026-05-22-apohara-v1.md\` — implementation plan.`,
		`- \`src/core/providers/agent-config.ts\` — your provider's declarative shape.`,
		`- \`packages/apohara-shared/types.ts\` — DO NOT edit; regenerated from Rust.`,
		``,
	];
	if (cfg) {
		lines.push(
			`Your hook config lives at \`${cfg.hookConfigPath}\` (${cfg.hookConfigShape}).`,
			`Hook installer name: \`${cfg.hookScriptName}\`.`,
			``,
		);
	}
	return lines.join("\n");
}

function commonWorkflowsSection(provider: ProviderId): string {
	const binary = AGENT_CONFIG[provider]?.binary ?? provider;
	return [
		`## 3. Common workflows`,
		``,
		`- **Discover state**: \`apohara state --json\` returns the current run, ledger path, sandbox availability.`,
		`- **Spawn yourself**: Apohara invokes \`${binary}\` for you via the per-binary FIFO queue — never spawn two \`${binary}\` children manually.`,
		`- **Dispatch a task**: \`POST /api/run\` with the task body. The dispatcher fans out to whichever provider's lane is free.`,
		`- **Commit changes**: use the \`apohara_commit_proposal\` MCP tool (G5/T2.6) — never \`git add .\`. Stage files individually.`,
		`- **Watch output**: PTY data flows through \`src/core/pty/registry.ts\`; OSC 998 escapes carry structured command state (\`src/core/pty/osc998.ts\`).`,
		``,
	].join("\n");
}

function escalationSection(): string {
	return [
		`## 4. Escalation paths`,
		``,
		`Stop and ask the human when:`,
		``,
		`- An action is irreversible (force push, drop table, \`rm -rf\`).`,
		`- A test failure does not reproduce on the second run — could be flake.`,
		`- The spec is ambiguous in a way that two readings give conflicting code.`,
		`- A commit would touch \`packages/apohara-shared/types.ts\` directly.`,
		`- You would need to add a provider outside the active roster (\`claude-code-cli\`, \`codex-cli\`, \`opencode-go\`).`,
		``,
		`Otherwise: surface assumptions in your reply, make the call, and let the user redirect you.`,
		``,
	].join("\n");
}

/**
 * Build the full self-teaching prompt for `provider`.
 */
export function buildLearnPrompt(
	provider: string,
	opts: BuildLearnPromptOptions = {},
): string {
	const allowed = opts.allowedProviders ?? DEFAULT_PROVIDERS;
	assertProvider(provider, allowed);

	const projectName = opts.projectName ?? "Apohara";
	const sections = [
		`# Learn Apohara — onboarding brief for \`${provider}\``,
		``,
		introductionSection(provider, projectName),
		keyFilesSection(provider),
		commonWorkflowsSection(provider),
		escalationSection(),
	];
	return sections.join("\n");
}
