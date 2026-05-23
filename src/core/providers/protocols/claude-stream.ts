/**
 * Claude Code stdout stream parser per spec §4.5 (nimbalyst #1.2).
 *
 * `claude --print --stream` emits NDJSON lines. Shapes observed:
 *   - { type: "event", subtype: "text", text: "..." }
 *   - { type: "event", subtype: "tool_use", name, input, id }
 *   - { type: "event", subtype: "tool_result", id, output, duration_ms }
 *   - { type: "event", subtype: "thinking", text }
 *   - { type: "result", usage: { input_tokens, output_tokens } }
 *   - { type: "permission_request", tool, input }
 *
 * We tolerate variations: `delta.text`, `message.content[]`, etc. Unknown
 * shapes are dropped silently — the stream is a moving target across SDK
 * versions and one rogue line should never crash `sendMessage`.
 */
import type { ProtocolEvent, TokenUsage } from "./AgentProtocol";

interface ClaudeRawLine {
  type?: string;
  subtype?: string;
  text?: string;
  content?: string;
  name?: string;
  input?: unknown;
  id?: string;
  output?: unknown;
  duration_ms?: number;
  delta?: { text?: string };
  message?: { content?: Array<{ type?: string; text?: string }> };
  usage?: { input_tokens?: number; output_tokens?: number };
  input_tokens?: number;
  output_tokens?: number;
  tool?: string;
}

export function parseClaudeLine(line: string): ProtocolEvent | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  let obj: ClaudeRawLine;
  try {
    obj = JSON.parse(trimmed) as ClaudeRawLine;
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;

  // Top-level shape: { type, ... }
  const t = obj.type;

  // "result" — final usage block.
  if (t === "result" && obj.usage) {
    const u = obj.usage;
    const inputTokens = u.input_tokens ?? 0;
    const outputTokens = u.output_tokens ?? 0;
    const usage: TokenUsage = {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    };
    return { kind: "usage", stepUsage: usage, cumulativeUsage: usage };
  }

  // "permission_request" — at top level.
  if (t === "permission_request" && typeof obj.tool === "string") {
    return {
      kind: "permission_request",
      toolName: obj.tool,
      input: obj.input ?? {},
    };
  }

  // "event" — subtype dispatches.
  if (t === "event") {
    const st = obj.subtype;
    if (st === "text") {
      const text = obj.text ?? obj.delta?.text ?? obj.content ?? "";
      if (typeof text !== "string" || text.length === 0) return null;
      return { kind: "text", content: text, turn: 0 };
    }
    if (st === "thinking" || st === "reasoning") {
      const text = obj.text ?? obj.delta?.text ?? "";
      if (typeof text !== "string" || text.length === 0) return null;
      return { kind: "reasoning", content: text };
    }
    if (st === "tool_use" && typeof obj.name === "string" && typeof obj.id === "string") {
      return {
        kind: "tool_call",
        toolName: obj.name,
        toolInput: obj.input ?? {},
        toolCallId: obj.id,
      };
    }
    if (st === "tool_result" && typeof obj.id === "string") {
      return {
        kind: "tool_result",
        toolCallId: obj.id,
        output: obj.output ?? null,
        durationMs: typeof obj.duration_ms === "number" ? obj.duration_ms : 0,
      };
    }
    if (st === "compact_boundary") return { kind: "compact_boundary" };
  }

  // "message" with content array (older SDK shape).
  if (obj.message && Array.isArray(obj.message.content)) {
    const texts: string[] = [];
    for (const c of obj.message.content) {
      if (c && c.type === "text" && typeof c.text === "string") texts.push(c.text);
    }
    if (texts.length > 0) {
      return { kind: "text", content: texts.join(""), turn: 0 };
    }
  }

  return null;
}
