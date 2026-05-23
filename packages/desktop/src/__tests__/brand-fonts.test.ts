/**
 * G9.A.1 regression guard: ensure brand-font imports and Tailwind 4 don't drift.
 *
 * The Sprint-9 UI rebrand depends on three @fontsource families being loaded
 * eagerly at app boot, and on Tailwind 4 being available for the upcoming
 * theme tokens (landed in G9.A.2). If any of these are removed by accident,
 * the rebrand silently regresses (CSS shows fallback fonts, utilities go missing).
 */

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("main.tsx imports the three brand font families", () => {
	const content = readFileSync(resolve(__dirname, "../main.tsx"), "utf-8");
	expect(content).toContain("@fontsource/press-start-2p");
	expect(content).toContain("@fontsource/jetbrains-mono");
	expect(content).toContain("@fontsource/inter");
});

test("Tailwind v4 is available in package.json", () => {
	const pkg = JSON.parse(
		readFileSync(resolve(__dirname, "../../package.json"), "utf-8"),
	);
	const deps = { ...pkg.dependencies, ...pkg.devDependencies };
	const hasTailwind = Object.keys(deps).some(
		(k) => k === "tailwindcss" || k.startsWith("@tailwindcss/"),
	);
	expect(hasTailwind).toBe(true);
});
