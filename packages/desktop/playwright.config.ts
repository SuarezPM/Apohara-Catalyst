import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the apohara-desktop M017.10 E2E smoke suite.
 *
 * We point at the system Chrome binary because Playwright doesn't ship
 * managed browsers for ubuntu26.04-x64 (the dev box's kernel is on the
 * bleeding edge). The smoke test runs headless against the already-
 * booted dev server on :7331; CI variants will boot it via
 * `bun --hot packages/desktop/src/server.ts &` in a job step.
 */
export default defineConfig({
	testDir: "./tests/e2e",
	timeout: 30_000,
	expect: { timeout: 5_000 },
	fullyParallel: false,
	reporter: [["list"]],
	use: {
		baseURL: process.env.APOHARA_DESKTOP_URL ?? "http://localhost:7331",
		headless: true,
		screenshot: "only-on-failure",
		trace: "off",
	},
	projects: [
		{
			name: "chromium",
			use: {
				...devices["Desktop Chrome"],
				channel: undefined,
				launchOptions: {
					executablePath: "/usr/bin/google-chrome",
				},
			},
		},
	],
});
