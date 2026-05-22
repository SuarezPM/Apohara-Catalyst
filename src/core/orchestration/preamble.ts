/**
 * Dispatch preamble per spec §3.6.
 * Every spawned worker receives this as the first system message.
 */

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
${driftSection}`;
}