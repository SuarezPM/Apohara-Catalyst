import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

const SRC = readFileSync(resolve(__dirname, "../Button.tsx"), "utf-8");

test("Button supports primary/secondary/destructive/ghost variants", () => {
  for (const v of ["primary", "secondary", "destructive", "ghost"]) {
    expect(SRC).toContain(`"${v}"`);
  }
});

test("Button uses Apohara palette tokens", () => {
  expect(SRC).toMatch(/var\(--apohara-(lime|red|bone|ink)/);
});

test("Button uses forwardRef for ref forwarding", () => {
  expect(SRC).toContain("forwardRef");
});
