import { expect, test } from "bun:test";
import {
	binaryName,
	detectPlatformSlug,
	type PlatformSlug,
} from "../../npx-cli/src/platform";

test("detectPlatformSlug returns one of the known slugs", () => {
	const slug = detectPlatformSlug();
	const known: PlatformSlug[] = [
		"linux-x64",
		"linux-arm64",
		"darwin-x64",
		"darwin-arm64",
		"win32-x64",
		"win32-arm64",
	];
	expect(known).toContain(slug);
});

test("binaryName matches the platform .exe suffix rule", () => {
	const expected =
		process.platform === "win32" ? "apohara-desktop.exe" : "apohara-desktop";
	expect(binaryName()).toBe(expected);
});
