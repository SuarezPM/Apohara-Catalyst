/**
 * AgentProtocol — unified interface for CLI-wrapper providers per spec §4.5.
 * Each provider (Claude/Codex/OpenCode) implements this; BaseAgentProvider
 * delegates session lifecycle to it. The discriminated union ProtocolEvent
 * abstracts per-provider event schemas into one canonical stream.
 *
 * G7.5.A.5 — Wires the G5.B.3 `classifyBlocked` classifier into the
 * protocol event handler. Drivers now emit `kind: "blocked"` carrying a
 * `BlockingEvent` payload; `classifyProtocolEvent` maps that (plus the
 * legacy `permission_request` variant) to a `BlockedSnapshot` with the
 * specific `BlockedReason` so the dispatcher can branch retry strategy
 * by cause (approval / auth / rate-limit / mcp_elicitation / stall).
 */
import {
  classifyBlocked,
  type BlockingEvent,
  type BlockedReason,
  type BlockedSnapshot,
  type RunTransition,
} from "../../dispatch/state";

export interface CreateSessionOpts {
  workspacePath: string;
  taskId?: string;
  worktreeId?: string;
  paneKey?: string;
  env?: Record<string, string>;
  systemPrompt?: string;
}

export interface SpawnedSession {
  providerId: string;
  spawnedAt: number;
}

export interface Message {
  role: "user" | "system";
  content: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export type ProtocolEvent =
  | { kind: "text"; content: string; turn: number }
  | { kind: "tool_call"; toolName: string; toolInput: unknown; toolCallId: string }
  | { kind: "tool_result"; toolCallId: string; output: unknown; durationMs: number }
  | { kind: "reasoning"; content: string; effortLevel?: "low" | "medium" | "high" }
  | { kind: "usage"; stepUsage: TokenUsage; cumulativeUsage: TokenUsage }
  | { kind: "compact_boundary" }
  | { kind: "permission_request"; toolName: string; input: unknown }
  /**
   * G7.5.A.5 — Driver-detected blocked condition. The driver translates
   * its CLI-specific signal (e.g. Claude's `permission_request`, Codex's
   * MCP elicitation, OpenCode's auth-expired rejection) into a canonical
   * `BlockingEvent` before yielding. Consumers run `classifyBlocked` on
   * `.event` to recover the typed `BlockedReason`.
   */
  | { kind: "blocked"; event: BlockingEvent }
  | { kind: "complete"; reason: "finished" | "interrupted" | "error" };

export interface AgentProtocol {
  createSession(opts: CreateSessionOpts): Promise<SpawnedSession>;
  resumeSession(sessionId: string): Promise<SpawnedSession>;
  forkSession(sessionId: string, atTurn: number): Promise<SpawnedSession>;
  sendMessage(sessionId: string, msg: Message): AsyncIterable<ProtocolEvent>;
  abortSession(sessionId: string): Promise<void>;
  /**
   * G5.A.1 (nimbalyst #1.1): append bytes to a session's stdin WITHOUT
   * closing the handle. Foundation for multi-turn (G5.A.6) — a follow-up
   * turn is just another `appendToStdin` to the same session.
   *
   * Throws if the session is unknown.
   */
  appendToStdin(sessionId: string, data: string): Promise<void>;
  /**
   * G5.A.1: explicitly close the stdin handle for a session. After this,
   * `appendToStdin` will reject. Subsequent `abortSession` still kills
   * the child.
   */
  endStdin(sessionId: string): Promise<void>;
}

// ---------------------------------------------------------------------
// G7.5.A.5 — Bridge ProtocolEvent → BlockedSnapshot → RunTransition
// ---------------------------------------------------------------------

/**
 * Maps a `ProtocolEvent` to a `BlockingEvent` if it carries a blocking
 * signal, else returns null. Covers two paths:
 *
 *   - `kind: "blocked"`           : passthrough of the embedded
 *                                   `BlockingEvent` payload.
 *   - `kind: "permission_request"`: legacy variant kept in the union for
 *                                   backwards compat. Mapped to
 *                                   `BlockingEvent { kind: "permission_request",
 *                                   label: "<toolName>:<input>" }` so the
 *                                   classifier still produces
 *                                   `approval_required`.
 *
 * All other variants return null (false-negative bias per G5.B.3 §0).
 */
export function protocolEventToBlocking(
  ev: ProtocolEvent,
): BlockingEvent | null {
  switch (ev.kind) {
    case "blocked":
      return ev.event;
    case "permission_request": {
      // Synthesize a label from toolName + truncated input for provenance.
      const inputStr =
        typeof ev.input === "string"
          ? ev.input
          : (() => {
              try {
                return JSON.stringify(ev.input);
              } catch {
                return "<unserializable>";
              }
            })();
      const label = `${ev.toolName}:${inputStr.slice(0, 80)}`;
      return { kind: "permission_request", label };
    }
    default:
      return null;
  }
}

/**
 * Convenience pipeline: ProtocolEvent → BlockingEvent → BlockedSnapshot.
 * Returns null for non-blocking events. Drivers / dispatchers call this
 * on every `ProtocolEvent` they receive and, on a non-null result, park
 * the task with `transitionToBlocked(snap)`.
 */
export function classifyProtocolEvent(
  ev: ProtocolEvent,
): BlockedSnapshot | null {
  const blocking = protocolEventToBlocking(ev);
  if (blocking === null) return null;
  return classifyBlocked(blocking);
}

/**
 * Wraps a `BlockedSnapshot` in a `RunTransition` so the dispatcher can
 * apply it as a single state-mutation unit (state=blocked + blockedReason
 * + provenance fields). Separate from `classifyProtocolEvent` so callers
 * that already have a snapshot (e.g. recovered from disk) can reuse the
 * transition shape.
 */
export function transitionToBlocked(snap: BlockedSnapshot): RunTransition {
  const trans: RunTransition = {
    state: "blocked",
    blockedReason: snap.reason,
    blockedSince: snap.since,
  };
  if (snap.detail !== undefined) trans.detail = snap.detail;
  return trans;
}

// Re-export the types so consumers don't have to dual-import from
// `state.ts` (single import surface for the protocol layer).
export type { BlockedReason, BlockedSnapshot, BlockingEvent, RunTransition };
