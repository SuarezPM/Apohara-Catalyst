import { expect, test } from "bun:test";
import { encodeWhisper } from "../../../src/core/whisper/encoder";
import { decodeWhisper } from "../../../src/core/whisper/decoder";

test("roundtrip preserves whisper fields", () => {
  const original = { tag: "judge", level: "info" as const, msg: "looks good", ts: 1234 };
  const wire = encodeWhisper(original);
  expect(wire.startsWith("\x1b[whisper:")).toBe(true);
  expect(wire.endsWith("\x1b\\")).toBe(true);
  const decoded = decodeWhisper(wire);
  expect(decoded).toEqual(original);
});

test("decoder rejects non-whisper stderr line", () => {
  expect(decodeWhisper("regular log line\n")).toBe(null);
});

test("decoder rejects malformed envelope", () => {
  expect(decodeWhisper("\x1b[whisper:not-json\x1b\\")).toBe(null);
});
