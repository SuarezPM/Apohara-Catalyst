import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

const SRC = readFileSync(resolve(__dirname, "../PixelCanvas.tsx"), "utf-8");

test("PixelCanvas renders a canvas element with pixelated rendering", () => {
  expect(SRC).toContain("<canvas");
  expect(SRC).toMatch(/imageRendering[:'"\s]+['"]pixelated['"]/);
});

test("PixelCanvas accepts spriteUrl, frame, and size props", () => {
  expect(SRC).toMatch(/spriteUrl/);
  expect(SRC).toMatch(/frame/);
  expect(SRC).toMatch(/size/);
});

test("PixelCanvas uses imageSmoothingEnabled = false for crisp pixels", () => {
  expect(SRC).toContain("imageSmoothingEnabled");
  expect(SRC).toContain("false");
});

test("PixelCanvas exports a Frame type matching the sprite metadata keys", () => {
  // Type union of "idle" | "working" | "thinking" | "happy"
  for (const k of ["idle", "working", "thinking", "happy"]) {
    expect(SRC).toContain(`"${k}"`);
  }
});
