/**
 * G5.A.7 — capabilities tooling.
 *
 * Each provider declares a flat capability set. Callers query
 * `hasCapability(providerId, capName)` so UI / feature-flag wiring
 * (G5.A.10) can gate experiences without hardcoding provider ids.
 */
import { test, expect } from "bun:test";
import {
  CAPABILITIES,
  getCapabilities,
  hasCapability,
  providersWithCapability,
} from "../../../src/core/providers/capabilities";

test("CAPABILITIES exports the canonical capability list", () => {
  expect(CAPABILITIES).toContain("multi_turn");
  expect(CAPABILITIES).toContain("streaming");
  expect(CAPABILITIES).toContain("file_snapshot");
  expect(CAPABILITIES).toContain("permission_request");
  expect(CAPABILITIES).toContain("reasoning");
});

test("getCapabilities returns claude-code-cli capability set", () => {
  const caps = getCapabilities("claude-code-cli");
  expect(caps).toContain("multi_turn");
  expect(caps).toContain("streaming");
  expect(caps).toContain("reasoning");
});

test("getCapabilities returns codex-cli capability set", () => {
  const caps = getCapabilities("codex-cli");
  expect(caps).toContain("streaming");
  expect(caps).toContain("multi_turn");
});

test("getCapabilities returns opencode-go capability set", () => {
  const caps = getCapabilities("opencode-go");
  expect(caps).toContain("streaming");
  expect(caps).toContain("multi_turn");
});

test("hasCapability returns true for declared, false for missing", () => {
  expect(hasCapability("claude-code-cli", "reasoning")).toBe(true);
  expect(hasCapability("opencode-go", "subagent_spawn")).toBe(false);
});

test("providersWithCapability lists matching provider ids", () => {
  const list = providersWithCapability("streaming");
  expect(list).toContain("claude-code-cli");
  expect(list).toContain("codex-cli");
  expect(list).toContain("opencode-go");
});

test("getCapabilities on unknown provider returns empty array", () => {
  expect(getCapabilities("nonexistent-provider" as never)).toEqual([]);
});
