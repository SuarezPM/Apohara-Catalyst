/**
 * OpenCode stdout stream parser per spec §4.5 (nimbalyst #1.2).
 *
 * `opencode run --format json` emits NDJSON. Observed shapes (from
 * tests/opencode-ndjson.test.ts and src/providers/cli-driver.ts:241):
 *
 *   - { type: "step_start", sessionID, timestamp }
 *   - { type: "text", sessionID, part: { text } }
 *   - { type: "reasoning", sessionID, part: { text } }
 *   - { type: "tool_use", sessionID, part: { tool, input, id } }
 *   - { type: "tool_result", sessionID, part: { id, output, durationMs } }
 *   - { type: "step_finish", sessionID, usage: { in, out } }
 *   - { type: "permission_request", part: { tool, input } }
 *
 * Unknown shapes drop silently.
 */
import type { ProtocolEvent, TokenUsage } from "./AgentProtocol";

interface OpenCodeRawLine {
  type?: string;
  sessionID?: string;
  timestamp?: number;
  part?: {
    text?: string;
    tool?: string;
    input?: unknown;
    id?: string;
    output?: unknown;
    durationMs?: number;
  };
  usage?: { in?: number; out?: number };
}

export function parseOpenCodeLine(line: string): ProtocolEvent | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  let obj: OpenCodeRawLine;
  try {
    obj = JSON.parse(trimmed) as OpenCodeRawLine;
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  switch (obj.type) {
    case "text": {
      const text = obj.part?.text ?? "";
      if (typeof text !== "string" || text.length === 0) return null;
      return { kind: "text", content: text, turn: 0 };
    }
    case "reasoning": {
      const text = obj.part?.text ?? "";
      if (typeof text !== "string" || text.length === 0) return null;
      return { kind: "reasoning", content: text };
    }
    case "tool_use": {
      const tool = obj.part?.tool;
      const id = obj.part?.id;
      if (typeof tool !== "string" || typeof id !== "string") return null;
      return {
        kind: "tool_call",
        toolName: tool,
        toolInput: obj.part?.input ?? {},
        toolCallId: id,
      };
    }
    case "tool_result": {
      const id = obj.part?.id;
      if (typeof id !== "string") return null;
      return {
        kind: "tool_result",
        toolCallId: id,
        output: obj.part?.output ?? null,
        durationMs:
          typeof obj.part?.durationMs === "number" ? obj.part.durationMs : 0,
      };
    }
    case "step_finish": {
      if (!obj.usage) return null;
      const inputTokens = obj.usage.in ?? 0;
      const outputTokens = obj.usage.out ?? 0;
      const usage: TokenUsage = {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      };
      return { kind: "usage", stepUsage: usage, cumulativeUsage: usage };
    }
    case "permission_request": {
      const tool = obj.part?.tool;
      if (typeof tool !== "string") return null;
      return {
        kind: "permission_request",
        toolName: tool,
        input: obj.part?.input ?? {},
      };
    }
    case "compact_boundary":
      return { kind: "compact_boundary" };
    default:
      return null;
  }
}
