/**
 * G9.A.2 regression guard: pin the Apohara Catalyst brand tokens in index.css.
 *
 * The Sprint-9 UI rebrand swaps the legacy v2.0 M017.7 cyan/violet palette for
 * the Apohara Catalyst tokens (lime/dark/bone/ink/red). If any of these vars
 * drift, or the legacy hex literals creep back in, this test fails fast.
 *
 * Source of truth: ecosystem/consilium/scripts/brand-tokens-source.json.
 */

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("index.css defines core Apohara palette vars", () => {
	const css = readFileSync(resolve(__dirname, "../index.css"), "utf-8");
	for (const v of [
		"--apohara-lime: #25B13F",
		"--apohara-dark: #2A2D3A",
		"--apohara-bone: #EDEFF0",
		"--apohara-ink: #0E1010",
		"--apohara-red: #B8262A",
	]) {
		expect(css).toContain(v);
	}
});

test("index.css defines typography stacks", () => {
	const css = readFileSync(resolve(__dirname, "../index.css"), "utf-8");
	expect(css).toContain("Press Start 2P");
	expect(css).toContain("JetBrains Mono");
	expect(css).toContain("Inter");
});

test("index.css drops legacy cyan/violet vars", () => {
	const css = readFileSync(resolve(__dirname, "../index.css"), "utf-8");
	expect(css).not.toContain("#6ee7f7");
	expect(css).not.toContain("#a78bfa");
});
