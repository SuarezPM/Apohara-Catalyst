import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

test("App.tsx imports sonner Toaster", () => {
  const content = readFileSync(resolve(__dirname, "../App.tsx"), "utf-8");
  expect(content).toContain("from \"sonner\"");
  expect(content).toMatch(/Toaster/);
});

test("Toaster is mounted in the App's render tree", () => {
  const content = readFileSync(resolve(__dirname, "../App.tsx"), "utf-8");
  expect(content).toMatch(/<Toaster/);
});

test("Toaster theme styles use Apohara palette tokens", () => {
  const content = readFileSync(resolve(__dirname, "../App.tsx"), "utf-8");
  expect(content).toMatch(/apohara-(lime|dark|bone|ink|dark-2)/);
});
