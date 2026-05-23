/**
 * G5.A.2 — sendMessage NDJSON parsers per nimbalyst #1.2.
 *
 * Each provider's stdout shape is different; the canonical ProtocolEvent
 * union absorbs that diversity. These tests pin the mapping line-by-line
 * so future provider-CLI version drift is caught at unit-test time.
 */
import { test, expect } from "bun:test";
import { parseClaudeLine } from "../../../../src/core/providers/protocols/claude-stream";
import { parseCodexLine } from "../../../../src/core/providers/protocols/codex-stream";
import { parseOpenCodeLine } from "../../../../src/core/providers/protocols/opencode-stream";

test("parseClaudeLine: event/text → ProtocolEvent.text", () => {
  const ev = parseClaudeLine('{"type":"event","subtype":"text","text":"hi"}');
  expect(ev).toEqual({ kind: "text", content: "hi", turn: 0 });
});

test("parseClaudeLine: event/tool_use → tool_call", () => {
  const ev = parseClaudeLine(
    '{"type":"event","subtype":"tool_use","name":"Bash","id":"t-1","input":{"cmd":"ls"}}',
  );
  expect(ev).toEqual({
    kind: "tool_call",
    toolName: "Bash",
    toolInput: { cmd: "ls" },
    toolCallId: "t-1",
  });
});

test("parseClaudeLine: result with usage → usage event", () => {
  const ev = parseClaudeLine(
    '{"type":"result","usage":{"input_tokens":120,"output_tokens":80}}',
  );
  expect(ev).toEqual({
    kind: "usage",
    stepUsage: { inputTokens: 120, outputTokens: 80, totalTokens: 200 },
    cumulativeUsage: { inputTokens: 120, outputTokens: 80, totalTokens: 200 },
  });
});

test("parseClaudeLine: malformed JSON → null (no throw)", () => {
  expect(parseClaudeLine("not json")).toBeNull();
  expect(parseClaudeLine("")).toBeNull();
});

test("parseClaudeLine: legacy message.content[] → text", () => {
  const ev = parseClaudeLine(
    '{"message":{"content":[{"type":"text","text":"yo"}]}}',
  );
  expect(ev).toEqual({ kind: "text", content: "yo", turn: 0 });
});

test("parseCodexLine: text → ProtocolEvent.text", () => {
  expect(parseCodexLine('{"type":"text","content":"hello"}')).toEqual({
    kind: "text",
    content: "hello",
    turn: 0,
  });
});

test("parseCodexLine: tool_call → tool_call event", () => {
  expect(
    parseCodexLine(
      '{"type":"tool_call","name":"Read","id":"tc-1","arguments":{"path":"/foo"}}',
    ),
  ).toEqual({
    kind: "tool_call",
    toolName: "Read",
    toolInput: { path: "/foo" },
    toolCallId: "tc-1",
  });
});

test("parseCodexLine: usage block", () => {
  expect(
    parseCodexLine('{"type":"usage","input_tokens":10,"output_tokens":20}'),
  ).toEqual({
    kind: "usage",
    stepUsage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    cumulativeUsage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
  });
});

test("parseCodexLine: unknown type → null", () => {
  expect(parseCodexLine('{"type":"nonsense"}')).toBeNull();
});

test("parseOpenCodeLine: text part → text event", () => {
  expect(
    parseOpenCodeLine('{"type":"text","sessionID":"s1","part":{"text":"hi"}}'),
  ).toEqual({ kind: "text", content: "hi", turn: 0 });
});

test("parseOpenCodeLine: tool_use → tool_call", () => {
  expect(
    parseOpenCodeLine(
      '{"type":"tool_use","sessionID":"s1","part":{"tool":"bash","id":"tu-1","input":{"cmd":"pwd"}}}',
    ),
  ).toEqual({
    kind: "tool_call",
    toolName: "bash",
    toolInput: { cmd: "pwd" },
    toolCallId: "tu-1",
  });
});

test("parseOpenCodeLine: step_finish usage → usage event", () => {
  expect(
    parseOpenCodeLine(
      '{"type":"step_finish","sessionID":"s1","usage":{"in":50,"out":100}}',
    ),
  ).toEqual({
    kind: "usage",
    stepUsage: { inputTokens: 50, outputTokens: 100, totalTokens: 150 },
    cumulativeUsage: { inputTokens: 50, outputTokens: 100, totalTokens: 150 },
  });
});

test("parseOpenCodeLine: reasoning with text", () => {
  expect(
    parseOpenCodeLine(
      '{"type":"reasoning","sessionID":"s1","part":{"text":"hmm"}}',
    ),
  ).toEqual({ kind: "reasoning", content: "hmm" });
});

test("parseOpenCodeLine: empty input → null", () => {
  expect(parseOpenCodeLine("")).toBeNull();
  expect(parseOpenCodeLine("not json")).toBeNull();
});
