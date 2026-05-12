/**
 * M017.10 Playwright E2E smoke test.
 *
 * Boots the visual orchestrator at http://localhost:7331 and verifies
 * the three-pane layout renders + the Objective pane round-trips a prompt
 * through the /api/enhance + SSE event stream. The dev server must already
 * be running (`bun --hot packages/desktop/src/server.ts`).
 */

import { expect, test } from "@playwright/test";

test.describe("Apohara visual orchestrator", () => {
	test("renders the three-pane layout + top bar", async ({ page }) => {
		await page.goto("/");

		// Brand mark is the first paint signal — confirms the JS bundle
		// resolved and React mounted.
		await expect(page.getByText("◈ Apohara")).toBeVisible();

		// Empty-state copy for the right two panes (no active run yet).
		await expect(page.getByText("No active run")).toBeVisible();

		// Each pane shows its title bar.
		await expect(
			page.getByRole("heading", { level: 2, name: "Objective" }),
		).toBeVisible();
		await expect(
			page.getByRole("heading", { level: 2, name: "Swarm" }),
		).toBeVisible();
		await expect(
			page.getByRole("heading", { level: 2, name: "Code + Diff" }),
		).toBeVisible();

		// GPU / Cloud radio toggle (M017.6 + M015.5).
		await expect(page.getByRole("radio", { name: "GPU" })).toBeVisible();
		await expect(page.getByRole("radio", { name: "Cloud" })).toBeVisible();
	});

	test("Run button transitions to active session", async ({ page }) => {
		await page.goto("/");

		// Type into the objective textarea + click Run. This hits POST
		// /api/run, which returns a sessionId; the React state flips and
		// the top bar should show the session id.
		const textarea = page.getByPlaceholder("Describe what to build…");
		await textarea.fill("build a CRUD endpoint with auth");

		const runButton = page.getByRole("button", { name: /Run/ });
		await expect(runButton).toBeEnabled();
		await runButton.click();

		// Session-id chip appears with the "Session " prefix; the run id
		// uses base36 + random6 so we just match the prefix shape.
		await expect(page.getByText(/^Session desktop-/)).toBeVisible({
			timeout: 10_000,
		});
	});

	test("roster picker persists selection + POST /api/roster (Gap 1)", async ({
		page,
	}) => {
		await page.goto("/");

		const rosterButton = page
			.getByRole("button", {
				name: /AIs|Apohara/,
				exact: false,
			})
			.first();
		await rosterButton.click();

		await expect(page.getByText("AI roster for this run")).toBeVisible();

		// Capture the POST /api/roster fired when we clear the roster.
		const rosterPost = page.waitForResponse(
			(resp) =>
				resp.url().endsWith("/api/roster") &&
				resp.request().method() === "POST",
		);
		await page.getByRole("button", { name: "Clear" }).click();
		const resp = await rosterPost;
		expect(resp.status()).toBe(200);
		const body = await resp.json();
		expect(Array.isArray(body.providers)).toBe(true);
		expect(body.providers.length).toBe(0);

		// localStorage mirrors the cleared state.
		const stored = await page.evaluate(() =>
			window.localStorage.getItem("apohara.providerRoster"),
		);
		expect(stored).toBe("[]");
	});

	test("mode toggle persists to localStorage + POST /api/mode", async ({
		page,
	}) => {
		await page.goto("/");

		// Default is GPU per the App.tsx initializer.
		const gpu = page.getByRole("radio", { name: "GPU" });
		const cloud = page.getByRole("radio", { name: "Cloud" });
		await expect(gpu).toHaveAttribute("aria-checked", "true");

		// Capture the /api/mode POST so we can verify the server
		// received it.
		const modePost = page.waitForResponse(
			(resp) =>
				resp.url().endsWith("/api/mode") && resp.request().method() === "POST",
		);
		await cloud.click();
		const resp = await modePost;
		expect(resp.status()).toBe(200);
		const body = await resp.json();
		expect(body.mode).toBe("cloud");

		await expect(cloud).toHaveAttribute("aria-checked", "true");

		const stored = await page.evaluate(() =>
			window.localStorage.getItem("apohara.routingMode"),
		);
		expect(stored).toBe("cloud");
	});
});
