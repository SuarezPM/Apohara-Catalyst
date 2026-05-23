/**
 * Dispatch preamble per spec §3.6.
 * Every spawned worker receives this as the first system message.
 */

import {
  buildAvailableActions,
  type ActionContext,
} from "./availableActions";

export interface SymbolRef {
  file: string;
  symbol: string;
  kind: string;
}

export interface TaskSymbolManifest {
  reads: SymbolRef[];
  writes: SymbolRef[];
  renames: SymbolRef[];
}

export interface DispatchPreambleInput {
  taskId: string;
  dispatchId: number;
  coordinatorHandle: string;
  taskSpec: {
    description: string;
    agentRole: "planner" | "coder" | "critic" | "judge";
    symbols: TaskSymbolManifest;
  };
  baseDrift?: { commitsBehind: number; recentSubjects: string[] };
  /**
   * agentrail #1 — when provided, the preamble appends an
   * `AVAILABLE ACTIONS` section with the enum-shaped action list so
   * the worker sees the same valid actions the UI does instead of
   * inferring them from free-text guidance.
   */
  availableActionsContext?: ActionContext;
}

function fmtSymbols(s: SymbolRef[]): string {
  if (s.length === 0) return "(none)";
  return s.map(x => `${x.file}::${x.symbol}`).join(", ");
}

export function buildDispatchPreamble(opts: DispatchPreambleInput): string {
  const driftSection = opts.baseDrift
    ? `\n## BASE DRIFT WARNING

Your worktree base is ${opts.baseDrift.commitsBehind} commits behind origin.
Recent commits you do NOT have:
${opts.baseDrift.recentSubjects.map(s => `  - ${s}`).join("\n")}

Proceed with caution. If your changes conflict, the consolidator will fail-merge.
`
    : "";

  // agentrail #1 — embed enum-shaped action list when the context is
  // known. Workers can introspect this list to know which terminal
  // actions are valid for their dispatch instead of inferring from
  // free-text. JSON pretty-printed so it is greppable in transcripts.
  const actionsSection = opts.availableActionsContext
    ? `\n## AVAILABLE ACTIONS

The following actions are exposed for this dispatch (the same enum the
UI renders). Disabled entries include a \`reason\`. You MUST NOT
attempt actions outside this list.

\`\`\`json
${JSON.stringify(buildAvailableActions(opts.availableActionsContext), null, 2)}
\`\`\`
`
    : "";

  return `# Apohara Worker Dispatch

You are a worker agent. You were spawned by the Apohara coordinator
to complete a specific task. Your coordinator handle is \`${opts.coordinatorHandle}\`.
Your task id is \`${opts.taskId}\`. Your dispatch id is \`${opts.dispatchId}\`.

## Communication protocol

**You MUST NOT use \`AskUserQuestion\`** — the user is not watching this pane;
the coordinator is. Use these CLI commands instead:

- \`apohara orchestration send --to ${opts.coordinatorHandle} --type worker_done --payload @result.json\`
- \`apohara orchestration send --to ${opts.coordinatorHandle} --type heartbeat\`
- \`apohara orchestration ask --to ${opts.coordinatorHandle} --question "..." --options "yes,no,defer"\`

## Your task

${opts.taskSpec.description}

### Symbols you declared

reads: ${fmtSymbols(opts.taskSpec.symbols.reads)}
writes: ${fmtSymbols(opts.taskSpec.symbols.writes)}
renames: ${fmtSymbols(opts.taskSpec.symbols.renames)}

If you find yourself needing to touch a symbol outside this declaration,
STOP and emit a \`coord_manifest_drift\` message — do not proceed silently.
${driftSection}${actionsSection}`;
}