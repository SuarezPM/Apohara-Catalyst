import { expect, test } from "bun:test";
import {
	checkForUpdates,
	semverCompare,
} from "../../../src/core/updater/check";

test("semverCompare: core comparison", () => {
	expect(semverCompare("1.0.0", "1.0.0")).toBe(0);
	expect(semverCompare("1.0.0", "1.0.1")).toBeLessThan(0);
	expect(semverCompare("1.2.0", "1.1.99")).toBeGreaterThan(0);
	expect(semverCompare("v2.0.0", "1.9.9")).toBeGreaterThan(0);
});

test("semverCompare: prerelease sorts BEFORE release", () => {
	expect(semverCompare("1.0.0-rc.1", "1.0.0")).toBeLessThan(0);
	expect(semverCompare("1.0.0-alpha", "1.0.0-rc.1")).toBeLessThan(0);
	expect(semverCompare("1.0.0-rc.2", "1.0.0-rc.1")).toBeGreaterThan(0);
});

test("semverCompare: build metadata is ignored", () => {
	expect(semverCompare("1.0.0+abc", "1.0.0+def")).toBe(0);
});

test("checkForUpdates: detects newer release via injected fetch", async () => {
	const fakeFetch: typeof fetch = async () => {
		return new Response(
			JSON.stringify([
				{
					tag_name: "v2.5.0",
					prerelease: false,
					draft: false,
					html_url: "https://github.com/x/y/releases/tag/v2.5.0",
					published_at: "2026-05-22T00:00:00Z",
					body: "release notes",
				},
				{
					tag_name: "v2.0.0",
					prerelease: false,
					draft: false,
					html_url: "https://github.com/x/y/releases/tag/v2.0.0",
					published_at: "2026-04-22T00:00:00Z",
					body: "old",
				},
			]),
			{ status: 200, headers: { "Content-Type": "application/json" } },
		);
	};
	const r = await checkForUpdates({
		currentVersion: "2.0.0",
		fetch: fakeFetch,
	});
	expect(r.updateAvailable).toBe(true);
	expect(r.latestVersion).toBe("v2.5.0");
	expect(r.releaseUrl).toBe("https://github.com/x/y/releases/tag/v2.5.0");
});

test("checkForUpdates: skips prereleases by default", async () => {
	const fakeFetch: typeof fetch = async () => {
		return new Response(
			JSON.stringify([
				{
					tag_name: "v3.0.0-rc.1",
					prerelease: true,
					draft: false,
					html_url: "https://github.com/x/y/releases/tag/v3.0.0-rc.1",
					published_at: "2026-06-22T00:00:00Z",
					body: "rc",
				},
				{
					tag_name: "v2.5.0",
					prerelease: false,
					draft: false,
					html_url: "https://github.com/x/y/releases/tag/v2.5.0",
					published_at: "2026-05-22T00:00:00Z",
					body: "ga",
				},
			]),
			{ status: 200 },
		);
	};
	const r = await checkForUpdates({
		currentVersion: "2.5.0",
		fetch: fakeFetch,
	});
	expect(r.updateAvailable).toBe(false);
	expect(r.latestVersion).toBe("v2.5.0");
});

test("checkForUpdates: opt-in prerelease picks the RC", async () => {
	const fakeFetch: typeof fetch = async () => {
		return new Response(
			JSON.stringify([
				{
					tag_name: "v3.0.0-rc.1",
					prerelease: true,
					draft: false,
					html_url: "https://github.com/x/y/releases/tag/v3.0.0-rc.1",
					published_at: "2026-06-22T00:00:00Z",
					body: "rc",
				},
				{
					tag_name: "v2.5.0",
					prerelease: false,
					draft: false,
					html_url: "https://github.com/x/y/releases/tag/v2.5.0",
					published_at: "2026-05-22T00:00:00Z",
					body: "ga",
				},
			]),
			{ status: 200 },
		);
	};
	const r = await checkForUpdates({
		currentVersion: "2.5.0",
		includePrerelease: true,
		fetch: fakeFetch,
	});
	expect(r.updateAvailable).toBe(true);
	expect(r.latestVersion).toBe("v3.0.0-rc.1");
	expect(r.prerelease).toBe(true);
});

test("checkForUpdates: returns no-update when nothing newer exists", async () => {
	const fakeFetch: typeof fetch = async () =>
		new Response(
			JSON.stringify([
				{
					tag_name: "v1.0.0",
					prerelease: false,
					draft: false,
					html_url: "x",
					published_at: "2026-01-01T00:00:00Z",
				},
			]),
			{ status: 200 },
		);
	const r = await checkForUpdates({
		currentVersion: "2.0.0",
		fetch: fakeFetch,
	});
	expect(r.updateAvailable).toBe(false);
});

test("checkForUpdates: surfaces HTTP errors", async () => {
	const fakeFetch: typeof fetch = async () =>
		new Response("nope", { status: 502 });
	const r = await checkForUpdates({
		currentVersion: "1.0.0",
		fetch: fakeFetch,
	});
	expect(r.error).toContain("502");
	expect(r.updateAvailable).toBe(false);
});

test("checkForUpdates: handles network failure", async () => {
	const fakeFetch: typeof fetch = async () => {
		throw new Error("ENOTFOUND");
	};
	const r = await checkForUpdates({
		currentVersion: "1.0.0",
		fetch: fakeFetch,
	});
	expect(r.error).toContain("fetch failed");
});
