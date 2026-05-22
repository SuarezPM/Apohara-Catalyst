import { test, expect } from "bun:test";
import { mergeWithDefaults, deepMerge } from "../../../src/core/persistence/defaults";

interface AppSettings {
  theme: "light" | "dark";
  features: {
    experimental: boolean;
    beta: boolean;
  };
  rosters: string[];
}

function createDefault(): AppSettings {
  return {
    theme: "dark",
    features: { experimental: false, beta: false },
    rosters: ["claude-code-cli", "codex-cli", "opencode-go"],
  };
}

test("mergeWithDefaults fills missing top-level fields", () => {
  const loaded = { theme: "light" as const };
  const merged = mergeWithDefaults(createDefault(), loaded as Partial<AppSettings>);
  expect(merged.theme).toBe("light");
  expect(merged.features.experimental).toBe(false);
  expect(merged.rosters).toEqual(["claude-code-cli", "codex-cli", "opencode-go"]);
});

test("mergeWithDefaults fills missing nested fields", () => {
  const loaded = { features: { experimental: true } as Partial<AppSettings["features"]> };
  const merged = mergeWithDefaults(createDefault(), loaded as Partial<AppSettings>);
  expect(merged.features.experimental).toBe(true);
  expect(merged.features.beta).toBe(false);
});

test("mergeWithDefaults handles arrays as full overrides (NOT merged)", () => {
  const loaded = { rosters: ["claude-code-cli"] };
  const merged = mergeWithDefaults(createDefault(), loaded as Partial<AppSettings>);
  expect(merged.rosters).toEqual(["claude-code-cli"]);
});

test("deepMerge merges nested objects without overwriting siblings", () => {
  const a = { a: 1, nested: { x: 1, y: 2 } };
  const b = { nested: { x: 10 } };
  const merged = deepMerge(a, b);
  expect(merged).toEqual({ a: 1, nested: { x: 10, y: 2 } });
});

test("mergeWithDefaults treats null/undefined values as 'use default'", () => {
  const loaded = { theme: null as unknown as undefined };
  const merged = mergeWithDefaults(createDefault(), loaded as Partial<AppSettings>);
  expect(merged.theme).toBe("dark");
});
