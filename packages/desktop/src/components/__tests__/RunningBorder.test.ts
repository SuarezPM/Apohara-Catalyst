import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

const SRC = readFileSync(resolve(__dirname, "../RunningBorder.tsx"), "utf-8");
const CSS = readFileSync(resolve(__dirname, "../../index.css"), "utf-8");

test("RunningBorder applies running-border class when active", () => {
  expect(SRC).toContain("running-border");
  expect(SRC).toMatch(/active.*\?\s*["']running-border["']\s*:\s*["']\s*["']/);
});

test("index.css defines @keyframes for running-border animation", () => {
  expect(CSS).toMatch(/@keyframes\s+apohara-running-border/);
  expect(CSS).toContain(".running-border");
});

test("running-border gradient uses Apohara lime palette", () => {
  expect(CSS).toContain("var(--apohara-lime)");
});
