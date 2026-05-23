import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

const SRC = readFileSync(resolve(__dirname, "../HeroBanner.tsx"), "utf-8");

test("HeroBanner imports PixelCanvas", () => {
	expect(SRC).toContain("PixelCanvas");
	expect(SRC).toMatch(/from\s+["']\.\/PixelCanvas(\.js)?["']/);
});

test("HeroBanner uses chief-mascot sprite path", () => {
	expect(SRC).toContain("/sprites/chief-mascot.png");
});

test("HeroBanner derives mascot frame from dagStore state", () => {
	// The frame variable should be computed conditionally on task statuses
	// — all four frame literals must appear and task statuses must drive them.
	expect(SRC).toContain('"idle"');
	expect(SRC).toContain('"working"');
	expect(SRC).toContain('"thinking"');
	expect(SRC).toContain('"happy"');
	expect(SRC).toContain("dispatched");
	expect(SRC).toContain("in_verification");
	expect(SRC).toContain("blocked");
	expect(SRC).toContain("failed");
	expect(SRC).toMatch(/const\s+frame\s*:\s*Frame/);
});

test("HeroBanner data-testid='hero-banner-mascot' anchors the PixelCanvas mount", () => {
	expect(SRC).toContain("hero-banner-mascot");
});
