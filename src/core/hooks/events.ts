/**
 * Hook event types per spec §3.5.
 *
 * Discriminated union — `kind` is the discriminator. parseHookEvent
 * validates the raw envelope received from the apohara-hooks-server
 * broadcast and returns a typed event or throws.
 */

export interface HookCommonContext {
  paneKey: string;
  taskId?: string;
  worktreeId?: string;
}

export type HookEvent =
  | { kind: "pre_tool_use"; commonContext: HookCommonContext; toolName: string; toolInput: unknown; timestamp: number }
  | { kind: "post_tool_use"; commonContext: HookCommonContext; toolName: string; toolOutput: unknown; durationMs: number; timestamp: number }
  | { kind: "post_tool_use_failure"; commonContext: HookCommonContext; toolName: string; error: string; timestamp: number }
  | { kind: "stop"; commonContext: HookCommonContext; reason: "completed" | "interrupted" | "crashed"; timestamp: number }
  | { kind: "user_prompt_submit"; commonContext: HookCommonContext; prompt: string; timestamp: number }
  | { kind: "permission_request"; commonContext: HookCommonContext; toolName: string; toolInput: unknown; scopeProposed?: "once" | "session" | "always"; timestamp: number };

interface RawEnvelope {
  type?: string;
  pane_key?: string;
  task_id?: string;
  worktree_id?: string;
  payload?: Record<string, unknown>;
}

export function parseHookEvent(raw: unknown): HookEvent {
  if (typeof raw !== "object" || raw === null) throw new Error("hook event must be object");
  const env = raw as RawEnvelope;
  if (!env.type) throw new Error("hook event missing type");
  if (typeof env.pane_key !== "string") throw new Error("hook event missing pane_key");

  const common: HookCommonContext = {
    paneKey: env.pane_key,
    taskId: env.task_id,
    worktreeId: env.worktree_id,
  };
  const p = env.payload ?? {};

  switch (env.type) {
    case "pre_tool_use":
      return {
        kind: "pre_tool_use",
        commonContext: common,
        toolName: requireString(p.tool_name, "tool_name"),
        toolInput: p.tool_input ?? null,
        timestamp: requireNumber(p.timestamp, "timestamp"),
      };
    case "post_tool_use":
      return {
        kind: "post_tool_use",
        commonContext: common,
        toolName: requireString(p.tool_name, "tool_name"),
        toolOutput: p.tool_output ?? null,
        durationMs: requireNumber(p.duration_ms ?? 0, "duration_ms"),
        timestamp: requireNumber(p.timestamp, "timestamp"),
      };
    case "post_tool_use_failure":
      return {
        kind: "post_tool_use_failure",
        commonContext: common,
        toolName: requireString(p.tool_name, "tool_name"),
        error: requireString(p.error, "error"),
        timestamp: requireNumber(p.timestamp, "timestamp"),
      };
    case "stop": {
      const reason = requireString(p.reason, "reason");
      if (!["completed", "interrupted", "crashed"].includes(reason)) {
        throw new Error(`invalid stop reason: ${reason}`);
      }
      return {
        kind: "stop",
        commonContext: common,
        reason: reason as "completed" | "interrupted" | "crashed",
        timestamp: requireNumber(p.timestamp, "timestamp"),
      };
    }
    case "user_prompt_submit":
      return {
        kind: "user_prompt_submit",
        commonContext: common,
        prompt: requireString(p.prompt, "prompt"),
        timestamp: requireNumber(p.timestamp, "timestamp"),
      };
    case "permission_request":
      return {
        kind: "permission_request",
        commonContext: common,
        toolName: requireString(p.tool_name, "tool_name"),
        toolInput: p.tool_input ?? null,
        scopeProposed: p.scope_proposed as ("once" | "session" | "always" | undefined),
        timestamp: requireNumber(p.timestamp, "timestamp"),
      };
    default:
      throw new Error(`unknown hook event type: ${env.type}`);
  }
}

function requireString(v: unknown, field: string): string {
  if (typeof v !== "string") throw new Error(`${field} must be string`);
  return v;
}
function requireNumber(v: unknown, field: string): number {
  if (typeof v !== "number") throw new Error(`${field} must be number`);
  return v;
}