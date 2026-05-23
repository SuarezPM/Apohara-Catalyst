import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

test("README reflects Catalyst branding", () => {
  const content = readFileSync(resolve(__dirname, "../../README.md"), "utf-8");
  expect(content).toContain("Apohara Catalyst");
  expect(content).toContain("local-first");
  expect(content.toLowerCase()).toContain("ttft");
  expect(content).toContain("@apohara/catalyst");
  expect(content).toContain("apohara");
});

test("README does not advertise removed/excluded features", () => {
  const content = readFileSync(resolve(__dirname, "../../README.md"), "utf-8");
  expect(content).not.toMatch(/Electron/i);
  expect(content).not.toMatch(/PostgreSQL/i);
  expect(content).not.toMatch(/PostHog/i);
  expect(content).not.toMatch(/marketplace/i);
});
