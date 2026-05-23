import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

const SRC = readFileSync(resolve(__dirname, "../CommandPalette.tsx"), "utf-8");

test("CommandPalette uses cmdk primitives", () => {
  expect(SRC).toMatch(/from\s+["']cmdk["']/);
  expect(SRC).toContain("Command");
});

test("CommandPalette binds Cmd+K / Ctrl+K via keydown listener", () => {
  expect(SRC).toMatch(/metaKey|ctrlKey/);
  expect(SRC).toMatch(/key\s*===?\s*["']k["']/);
});

test("CommandPalette uses Apohara palette tokens", () => {
  expect(SRC).toMatch(/var\(--apohara-(lime|dark|bone|ink|dark-2)/);
});

test("CommandPalette declares a base action list", () => {
  // At least a few canonical actions visible to user
  const actionKeywords = ["doctor", "Plans", "verify", "task", "view"];
  const matched = actionKeywords.filter(k => SRC.toLowerCase().includes(k.toLowerCase()));
  expect(matched.length).toBeGreaterThanOrEqual(2);
});
