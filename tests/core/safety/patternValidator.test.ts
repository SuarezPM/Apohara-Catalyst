import { test, expect } from "bun:test";
import { isValidPattern } from "../../../src/core/safety/patternValidator";

test("accepts well-formed patterns", () => {
  expect(isValidPattern("Bash(npm test:*)")).toBe(true);
  expect(isValidPattern("WebFetch(domain:github.com)")).toBe(true);
  expect(isValidPattern("Edit(src/**)")).toBe(true);
  expect(isValidPattern("mcp__apohara__list_runs")).toBe(true);
});

test("rejects garbage from LLM output bleeding", () => {
  expect(isValidPattern("Bash(const:*)")).toBe(false);
  expect(isValidPattern("Bash(```:*)")).toBe(false);
  expect(isValidPattern("Bash(import:*)")).toBe(false);
});

test("rejects empty or whitespace-only patterns", () => {
  expect(isValidPattern("")).toBe(false);
  expect(isValidPattern("   ")).toBe(false);
});