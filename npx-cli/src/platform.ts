/**
 * Platform / arch detection for the npx wrapper. Returns the
 * canonical `<platform>-<arch>` slug used by the GitHub release
 * artifacts (e.g. `linux-x64`, `darwin-arm64`, `win32-x64`).
 *
 * Mirrors vibe-kanban's `npx-cli/src/cli.ts:281-336` shape so the
 * release asset naming stays predictable across our two npx
 * packages (apohara + apohara-context-forge).
 */
import os from "node:os";

export type PlatformSlug =
	| "linux-x64"
	| "linux-arm64"
	| "darwin-x64"
	| "darwin-arm64"
	| "win32-x64"
	| "win32-arm64";

export function detectPlatformSlug(): PlatformSlug {
	const platform = process.platform;
	const arch = process.arch;

	if (platform === "linux") {
		if (arch === "x64") return "linux-x64";
		if (arch === "arm64") return "linux-arm64";
	}
	if (platform === "darwin") {
		if (arch === "x64") return "darwin-x64";
		if (arch === "arm64") return "darwin-arm64";
	}
	if (platform === "win32") {
		if (arch === "x64") return "win32-x64";
		if (arch === "arm64") return "win32-arm64";
	}
	throw new Error(
		`apohara npx wrapper: unsupported platform/arch ${platform}/${arch}. ` +
			`Build from source via 'cargo build --release' from the repo root.`,
	);
}

export function binaryName(): string {
	return process.platform === "win32" ? "apohara-desktop.exe" : "apohara-desktop";
}
