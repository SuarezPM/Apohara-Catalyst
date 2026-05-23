import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

const SRC = readFileSync(resolve(__dirname, "../Card.tsx"), "utf-8");

test("Card uses Apohara surface + border tokens", () => {
  expect(SRC).toMatch(/var\(--apohara-dark|var\(--surface/);
  expect(SRC).toContain("var(--border)");
});

test("Card spreads HTMLDivElement props", () => {
  expect(SRC).toContain("HTMLAttributes<HTMLDivElement>");
});
