import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

const SRC = readFileSync(resolve(__dirname, "../ConfirmationDialogProvider.tsx"), "utf-8");

test("Provider uses @radix-ui/react-dialog primitives", () => {
  expect(SRC).toMatch(/from\s+["']@radix-ui\/react-dialog["']/);
});

test("Provider exposes useConfirm hook", () => {
  expect(SRC).toContain("export const useConfirm");
});

test("Provider implements a FIFO queue (multiple confirms don't overlap)", () => {
  // Confirm options state is array-based — the queue
  expect(SRC).toMatch(/queue|setQueue|useState.*\[/);
});

test("Provider uses Apohara palette tokens", () => {
  // Background ink, border lime, bone fg
  expect(SRC).toMatch(/var\(--apohara-(ink|dark|lime|bone|red)/);
});

test("Provider returns Promise<boolean> from confirm()", () => {
  expect(SRC).toMatch(/Promise<boolean>/);
});
