/**
 * agentrail #1 — universal contract for what the user/agent can do given
 * current task + workspace state. Replaces free-text preamble guidance
 * with an enum-shaped action list that the UI renders as buttons and the
 * server validates pre-dispatch.
 *
 * The structure intentionally mirrors a discriminated state machine so a
 * downstream renderer can show severity-themed buttons (normal /
 * destructive / elevated) and surface `reason` to the user when an
 * action is disabled. Workers receive the JSON-serialized list in the
 * dispatch preamble (via `buildDispatchPreamble` opts) so they know
 * which terminal actions are even possible from their context.
 */

export type ActionSeverity = "normal" | "destructive" | "elevated";
export type TaskStateLike =
  | "pending"
  | "ready"
  | "running"
  | "blocked"
  | "done"
  | "failed";
export type WorkspaceTrust = "trusted" | "untrusted" | "pending";

export interface AvailableAction {
  label: string;
  severity: ActionSeverity;
  enabled: boolean;
  reason?: string;
}

export interface ActionContext {
  taskState: TaskStateLike;
  hasUncommittedChanges: boolean;
  workspaceTrust: WorkspaceTrust;
}

function dispatchReason(ctx: ActionContext): string | undefined {
  if (ctx.hasUncommittedChanges) {
    return "Workspace has uncommitted changes; commit or stash first.";
  }
  if (ctx.workspaceTrust !== "trusted") {
    return `Workspace trust is ${ctx.workspaceTrust}; cannot dispatch.`;
  }
  if (ctx.taskState !== "ready") {
    return `Task state is ${ctx.taskState}; not ready.`;
  }
  return undefined;
}

export function buildAvailableActions(ctx: ActionContext): AvailableAction[] {
  const actions: AvailableAction[] = [];

  // Dispatch — primary action when task is ready
  const dispatchEnabled =
    ctx.taskState === "ready" &&
    !ctx.hasUncommittedChanges &&
    ctx.workspaceTrust === "trusted";
  actions.push({
    label: "Dispatch",
    severity: "normal",
    enabled: dispatchEnabled,
    reason: dispatchEnabled ? undefined : dispatchReason(ctx),
  });

  // Abort — destructive; only valid when running
  actions.push({
    label: "Abort",
    severity: "destructive",
    enabled: ctx.taskState === "running",
  });

  // Force Re-run — elevated; bypass checks on terminal states
  actions.push({
    label: "Force Re-run",
    severity: "elevated",
    enabled: ctx.taskState === "failed" || ctx.taskState === "done",
  });

  return actions;
}
