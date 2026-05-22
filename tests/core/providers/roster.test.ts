import { test, expect, beforeEach, afterEach } from "bun:test";
import { getActiveProviders } from "../../../src/core/providers/active-roster";
import { ClaudeCodeProvider } from "../../../src/core/providers/ClaudeCodeProvider";
import { CodexProvider } from "../../../src/core/providers/CodexProvider";
import { OpenCodeProvider } from "../../../src/core/providers/OpenCodeProvider";

let originalEnv: string | undefined;
beforeEach(() => { originalEnv = process.env.APOHARA_LEGACY_PROVIDERS; delete process.env.APOHARA_LEGACY_PROVIDERS; });
afterEach(() => { if (originalEnv !== undefined) process.env.APOHARA_LEGACY_PROVIDERS = originalEnv; });

test("getActiveProviders returns exactly 3 in default mode", () => {
  const providers = getActiveProviders();
  expect(providers.length).toBe(3);
  expect(providers.find(p => p instanceof ClaudeCodeProvider)).toBeDefined();
  expect(providers.find(p => p instanceof CodexProvider)).toBeDefined();
  expect(providers.find(p => p instanceof OpenCodeProvider)).toBeDefined();
});

test("getActiveProviders returns more when APOHARA_LEGACY_PROVIDERS=1", () => {
  process.env.APOHARA_LEGACY_PROVIDERS = "1";
  const providers = getActiveProviders();
  expect(providers.length).toBeGreaterThan(3);
});