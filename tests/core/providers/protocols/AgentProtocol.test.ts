import { test, expect } from "bun:test";
import type { AgentProtocol, ProtocolEvent } from "../../../../src/core/providers/protocols/AgentProtocol";

test("ProtocolEvent discriminated union compiles", () => {
  const events: ProtocolEvent[] = [
    { kind: "text", content: "hello", turn: 1 },
    { kind: "tool_call", toolName: "Bash", toolInput: { command: "ls" }, toolCallId: "tc-1" },
    { kind: "tool_result", toolCallId: "tc-1", output: "...", durationMs: 42 },
    { kind: "reasoning", content: "thinking" },
    { kind: "usage", stepUsage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 }, cumulativeUsage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 } },
    { kind: "compact_boundary" },
    { kind: "permission_request", toolName: "Bash", input: {} },
    { kind: "complete", reason: "finished" },
  ];
  expect(events.length).toBe(8);
});

test("AgentProtocol type has the expected methods", () => {
  const stub: AgentProtocol = {
    async createSession(_opts) { return { providerId: "sid", spawnedAt: 0 }; },
    async resumeSession(_id) { return { providerId: "sid", spawnedAt: 0 }; },
    async forkSession(_id, _turn) { return { providerId: "sid", spawnedAt: 0 }; },
    async *sendMessage(_id, _msg) { /* generator */ },
    async abortSession(_id) {},
  };
  expect(typeof stub.createSession).toBe("function");
  expect(typeof stub.sendMessage).toBe("function");
});