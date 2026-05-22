import { test, expect } from "bun:test";
import { extractTextFromOpencodeNdjson } from "../src/providers/cli-driver";

test("opencode NDJSON: concatenates text events", () => {
  const raw = [
    '{"type":"step_start","timestamp":1,"sessionID":"s1"}',
    '{"type":"text","timestamp":2,"sessionID":"s1","part":{"text":"Hello "}}',
    '{"type":"reasoning","timestamp":3,"sessionID":"s1","part":{"text":"hmm"}}',
    '{"type":"text","timestamp":4,"sessionID":"s1","part":{"text":"world!"}}',
    '{"type":"step_finish","timestamp":5,"sessionID":"s1"}',
  ].join("\n");
  expect(extractTextFromOpencodeNdjson(raw)).toBe("Hello world!");
});

test("opencode NDJSON: drops tool_use without text", () => {
  const raw = '{"type":"tool_use","sessionID":"s1","part":{"tool":"bash"}}';
  expect(extractTextFromOpencodeNdjson(raw)).toBe("");
});

test("opencode NDJSON: falls back to raw text on non-JSON stream", () => {
  expect(extractTextFromOpencodeNdjson("plain text output")).toBe("plain text output");
});

test("opencode NDJSON: empty input", () => {
  expect(extractTextFromOpencodeNdjson("")).toBe("");
});

test("opencode NDJSON: ignores ANSI escapes", () => {
  const raw = '\x1b[32m{"type":"text","part":{"text":"hi"}}\x1b[0m';
  expect(extractTextFromOpencodeNdjson(raw)).toBe("hi");
});
