import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

const SRC = readFileSync(resolve(__dirname, "../Input.tsx"), "utf-8");

test("Input uses Apohara dark + lime focus", () => {
  expect(SRC).toContain("var(--apohara-dark");
  expect(SRC).toMatch(/--apohara-lime/);
});

test("Input uses forwardRef", () => {
  expect(SRC).toContain("forwardRef");
});
