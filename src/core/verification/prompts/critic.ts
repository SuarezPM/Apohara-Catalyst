/**
 * chorus H5 — critic system reminder prompts.
 *
 * Injected into verification mesh runs to make the critic an explicit
 * role: surface red flags, cite past incidents, request a
 * rationalization-detection checklist. The output is plain Markdown
 * because every wrapped CLI consumes Markdown as system context.
 *
 * Pure function: callers compose the incidents list from the persistent
 * ledger and pass it here; no I/O.
 */

export interface CriticContext {
  taskDescription: string;
  priorAttempts: number;
  incidents?: string[];
}

export function buildCriticPrompt(ctx: CriticContext): string {
  const lines: string[] = [
    "You are the critic. Review the proposed implementation.",
    "",
    "## Task",
    ctx.taskDescription,
    "",
    `## Prior attempts: ${ctx.priorAttempts}`,
  ];

  if (ctx.incidents && ctx.incidents.length > 0) {
    lines.push("", "## Past incidents to watch for");
    for (const inc of ctx.incidents) {
      lines.push(`- ${inc}`);
    }
  }

  lines.push(
    "",
    "## Red flags / rationalization checklist",
    "- Is this solving the wrong problem?",
    "- Does the implementation match the spec exactly?",
    "- Are there over-engineered abstractions?",
    "- Is error handling defensive without justification?",
    "- Are tests verifying behavior or just mocks?",
    "- Did the prior attempts fail for the same root cause?",
    "",
    "Report: APPROVE | NEEDS_CHANGES (with specific items) | REJECT (with rationale).",
  );

  return lines.join("\n");
}
