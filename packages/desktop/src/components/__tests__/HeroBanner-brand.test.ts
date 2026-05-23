/**
 * G9.A.3 regression guard: HeroBanner displays the Apohara Catalyst brand.
 *
 * Sprint-9 rebrand replaces the v1.0 plain headline with the pixel-art
 * "APOHARA CATALYST" wordmark in lime via the `.font-display` utility class
 * (Press Start 2P). Legacy strings like "Apohara Ultimate" must not creep
 * back in. The empty-state CTA contract (`onSeedDemo`) stays intact — the
 * App-level test in App.tsx and consumer behaviour are unchanged.
 *
 * Source of truth: docs/superpowers/specs/2026-05-23-apohara-catalyst-ui.md.
 */

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
	resolve(__dirname, "../HeroBanner.tsx"),
	"utf-8",
);

test("HeroBanner renders the APOHARA CATALYST wordmark", () => {
	expect(source).toContain("APOHARA CATALYST");
});

test("HeroBanner applies the .font-display utility for the wordmark", () => {
	expect(source).toContain("font-display");
});

test("HeroBanner uses the Catalyst lime token, not hard-coded legacy hex", () => {
	expect(source).toContain("var(--apohara-lime)");
});

test("HeroBanner does NOT reference the legacy 'Apohara Ultimate' brand", () => {
	expect(source).not.toContain("Apohara Ultimate");
});

test("HeroBanner preserves the onSeedDemo CTA contract (App.tsx consumer)", () => {
	expect(source).toContain("onSeedDemo");
	expect(source).toContain("hero-banner-seed-cta");
});
