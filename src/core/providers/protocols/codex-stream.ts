/**
 * Codex stdout stream parser per spec §4.5 (nimbalyst #1.2).
 *
 * `codex exec --json` emits NDJSON: one JSON object per line. We map each
 * recognized object to a canonical `ProtocolEvent`. Unknown shapes are
 * dropped silently — the stream is a moving target across codex versions
 * and we never want a single rogue line to crash sendMessage.
 *
 * Supported shapes (best-effort, derived from observed codex output):
 *   - { type: "text", content: "..." } → ProtocolEvent.text
 *   - { type: "reasoning", content: "..." } → ProtocolEvent.reasoning
 *   - { type: "tool_call", name, arguments, id } → ProtocolEvent.tool_call
 *   - { type: "tool_result", id, output, duration_ms } → ProtocolEvent.tool_result
 *   - { type: "usage", input_tokens, output_tokens } → ProtocolEvent.usage (step only)
 *   - { type: "permission_request", tool, input } → permission_request
 *
 * G5.G.5 sanitizer (line-framed) runs UPSTREAM of this parser at a different
 * layer — here we just trust the input bytes are already non-mixed.
 */
import type { ProtocolEvent, TokenUsage } from "./AgentProtocol";

interface CodexRawLine {
  type?: string;
  content?: string;
  text?: string;
  name?: string;
  arguments?: unknown;
  id?: string;
  output?: unknown;
  duration_ms?: number;
  input_tokens?: number;
  output_tokens?: number;
  tool?: string;
  input?: unknown;
  effort?: "low" | "medium" | "high";
}

/** Test-exposed: parse a single NDJSON line. Returns null for unknown/empty. */
export function parseCodexLine(line: string): ProtocolEvent | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  let obj: CodexRawLine;
  try {
    obj = JSON.parse(trimmed) as CodexRawLine;
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object" || typeof obj.type !== "string") {
    return null;
  }
  switch (obj.type) {
    case "text": {
      const content = obj.content ?? obj.text ?? "";
      if (typeof content !== "string" || content.length === 0) return null;
      return { kind: "text", content, turn: 0 };
    }
    case "reasoning": {
      const content = obj.content ?? obj.text ?? "";
      if (typeof content !== "string" || content.length === 0) return null;
      const ev: ProtocolEvent = { kind: "reasoning", content };
      if (obj.effort) (ev as { effortLevel?: string }).effortLevel = obj.effort;
      return ev;
    }
    case "tool_call": {
      if (typeof obj.name !== "string" || typeof obj.id !== "string") return null;
      return {
        kind: "tool_call",
        toolName: obj.name,
        toolInput: obj.arguments ?? {},
        toolCallId: obj.id,
      };
    }
    case "tool_result": {
      if (typeof obj.id !== "string") return null;
      return {
        kind: "tool_result",
        toolCallId: obj.id,
        output: obj.output ?? null,
        durationMs: typeof obj.duration_ms === "number" ? obj.duration_ms : 0,
      };
    }
    case "usage": {
      const inputTokens = obj.input_tokens ?? 0;
      const outputTokens = obj.output_tokens ?? 0;
      const stepUsage: TokenUsage = {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      };
      // Cumulative is best-effort: caller (sendMessage / step-usage attribution)
      // tracks the running total. Here we echo step as cumulative; callers
      // override via the dedicated step-usage tracker (G5.A.4).
      return { kind: "usage", stepUsage, cumulativeUsage: stepUsage };
    }
    case "permission_request": {
      if (typeof obj.tool !== "string") return null;
      return {
        kind: "permission_request",
        toolName: obj.tool,
        input: obj.input ?? {},
      };
    }
    case "compact_boundary": {
      return { kind: "compact_boundary" };
    }
    default:
      return null;
  }
}
