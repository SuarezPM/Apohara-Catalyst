/**
 * G5.A.2 — sendMessage end-to-end via fake child process.
 *
 * The Protocol classes use `node:child_process.spawn` directly, so we
 * exercise the full path by spawning `node -e` with a script that emits
 * known NDJSON on stdout. This is the same "fake CLI" pattern used by
 * tests/integration/protocol-delegated-spawn.test.ts.
 */
import { test, expect } from "bun:test";
import { spawn } from "node:child_process";
import type { ProtocolEvent } from "../../../../src/core/providers/protocols/AgentProtocol";
import { parseOpenCodeLine } from "../../../../src/core/providers/protocols/opencode-stream";

/**
 * Helper: spawn a Node subprocess that streams known NDJSON lines, then
 * consume its stdout the same way OpenCodeProtocol.sendMessage does and
 * collect the resulting ProtocolEvents.
 */
async function streamEventsFromFakeChild(
  ndjsonLines: string[],
): Promise<ProtocolEvent[]> {
  const script = `
    const lines = ${JSON.stringify(ndjsonLines)};
    for (const l of lines) process.stdout.write(l + "\\n");
  `;
  const child = spawn("node", ["-e", script], { stdio: ["pipe", "pipe", "pipe"] });
  const events: ProtocolEvent[] = [];
  let buf = "";
  for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
    buf += chunk.toString("utf8");
    let nl = buf.indexOf("\n");
    while (nl !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      const ev = parseOpenCodeLine(line);
      if (ev) events.push(ev);
      nl = buf.indexOf("\n");
    }
  }
  if (buf.length > 0) {
    const ev = parseOpenCodeLine(buf);
    if (ev) events.push(ev);
  }
  return events;
}

test("end-to-end: NDJSON child → ProtocolEvent stream (opencode)", async () => {
  const events = await streamEventsFromFakeChild([
    '{"type":"step_start","sessionID":"s1","timestamp":1}',
    '{"type":"text","sessionID":"s1","part":{"text":"Hello "}}',
    '{"type":"text","sessionID":"s1","part":{"text":"world"}}',
    '{"type":"step_finish","sessionID":"s1","usage":{"in":42,"out":7}}',
  ]);
  // step_start is filtered (no canonical mapping); we expect 2 text + 1 usage.
  expect(events.length).toBe(3);
  expect(events[0]).toEqual({ kind: "text", content: "Hello ", turn: 0 });
  expect(events[1]).toEqual({ kind: "text", content: "world", turn: 0 });
  expect(events[2]?.kind).toBe("usage");
});

test("end-to-end: handles broken JSON gracefully (drops silently)", async () => {
  const events = await streamEventsFromFakeChild([
    "not json",
    '{"type":"text","sessionID":"s1","part":{"text":"after-bad"}}',
  ]);
  expect(events.length).toBe(1);
  expect(events[0]).toEqual({ kind: "text", content: "after-bad", turn: 0 });
});
