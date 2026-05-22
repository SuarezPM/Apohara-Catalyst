/**
 * AsyncLocalStorage per-request context per spec §0.15.
 *
 * Wrap each orchestration handler / API call / dispatch with
 * runWithRequestContext. Inside the callback, getRequestContext() and
 * getRequestLogger() work without passing parameters through the call stack.
 *
 * This makes structured logging (every log line tagged with dispatchId/sessionId)
 * trivial and prevents context leaks between concurrent flows.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  dispatchId: string;
  sessionId: string;
  /** Optional task identifier when context is task-scoped */
  taskId?: string;
}

export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
}

const storage = new AsyncLocalStorage<RequestContext>();

export async function runWithRequestContext<T>(
  ctx: RequestContext,
  fn: () => Promise<T> | T,
): Promise<T> {
  return storage.run(ctx, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function getRequestLogger(): Logger {
  const ctx = getRequestContext();
  const prefix = ctx ? `[${ctx.dispatchId}/${ctx.sessionId}${ctx.taskId ? `/${ctx.taskId}` : ""}] ` : "";
  return {
    info: (m, meta) => console.log(prefix + m, meta ?? ""),
    warn: (m, meta) => console.warn(prefix + m, meta ?? ""),
    error: (m, meta) => console.error(prefix + m, meta ?? ""),
    debug: (m, meta) => console.debug(prefix + m, meta ?? ""),
  };
}
