/**
 * AgentProtocol — unified interface for CLI-wrapper providers per spec §4.5.
 * Each provider (Claude/Codex/OpenCode) implements this; BaseAgentProvider
 * delegates session lifecycle to it. The discriminated union ProtocolEvent
 * abstracts per-provider event schemas into one canonical stream.
 */

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