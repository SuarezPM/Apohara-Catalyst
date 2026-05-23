/**
 * Per-provider prompt builders per spec §4.5 (nimbalyst #1.3).
 *
 * Each provider responds differently to system-prompt formatting:
 * Claude likes XML-flavoured tags, Codex prefers terse bullet headers,
 * OpenCode wants a role-based template. This module owns the per-provider
 * templates and the simple `{{var}}` substitution machinery.
 *
 * Callers (BaseAgentProvider.spawn) compose a `PromptVars` bag and call
 * `buildSystemPrompt(this.id, vars)`. The result becomes
 * `CreateSessionOpts.systemPrompt` on the next createSession.
 *
 * Templates are intentionally small — Apohara's full context (memory,
 * spec, plan) is injected via the orchestration layer + MCP, not via
 * the system prompt.
 */
import type { ProviderId } from "../agent-config";

export interface PromptVars {
  taskId: string;
  role: string;
  workspace: string;
  /** Optional free-form note appended after the per-provider footer. */
  note?: string;
}

const DEFAULT_TEMPLATES: Record<string, string> = {
  "claude-code-cli": [
    "<apohara_session>",
    "  <task_id>{{taskId}}</task_id>",
    "  <role>{{role}}</role>",
    "  <workspace>{{workspace}}</workspace>",
    "</apohara_session>",
    "",
    "You are running inside Apohara as a {{role}}. Stay within the workspace",
    "boundary, never spawn nested agents, and respect MCP-injected limits.",
  ].join("\n"),
  "codex-cli": [
    "[apohara]",
    "task   : {{taskId}}",
    "role   : {{role}}",
    "cwd    : {{workspace}}",
    "",
    "Be terse. Show diffs not prose. Stop on hook-server denial.",
  ].join("\n"),
  "opencode-go": [
    "# Apohara session",
    "- task: {{taskId}}",
    "- role: {{role}}",
    "- workspace: {{workspace}}",
    "",
    "Use opencode tools only; do not call out-of-band shells.",
  ].join("\n"),
};

const GENERIC_TEMPLATE = [
  "Apohara session",
  "task: {{taskId}}",
  "role: {{role}}",
  "workspace: {{workspace}}",
].join("\n");

const overrides = new Map<string, string | null>();

/**
 * Register (or clear) a per-provider template at runtime. Useful for tests
 * and for callers wanting to layer a workspace-specific preamble.
 * Pass `null` to reset to the built-in default.
 */
export function registerPromptTemplate(
  providerId: string,
  template: string | null,
): void {
  if (template === null) overrides.delete(providerId);
  else overrides.set(providerId, template);
}

function resolveTemplate(providerId: string): string {
  if (overrides.has(providerId)) {
    const v = overrides.get(providerId);
    if (typeof v === "string") return v;
  }
  if (providerId in DEFAULT_TEMPLATES) {
    return DEFAULT_TEMPLATES[providerId] as string;
  }
  return GENERIC_TEMPLATE;
}

/** Replace `{{key}}` with `vars[key]` (no recursion). */
function substitute(
  template: string,
  vars: Record<string, string | undefined>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, key) => {
    const v = vars[key as string];
    return typeof v === "string" ? v : `{{${key}}}`;
  });
}

export function buildSystemPrompt(
  providerId: ProviderId | string,
  vars: PromptVars,
): string {
  const template = resolveTemplate(providerId as string);
  const body = substitute(template, vars as unknown as Record<string, string>);
  if (vars.note) return `${body}\n\n${vars.note}`;
  return body;
}
