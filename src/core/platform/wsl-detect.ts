/**
 * WSL (Windows Subsystem for Linux) detection + path conversion.
 *
 * G5.I.1 — orca inspiration. WSL processes see Windows-mounted drives at
 * `/mnt/<letter>/...` and need to translate between native POSIX paths and
 * NT-style `C:\...` paths when shelling out to Windows binaries (e.g. `cmd.exe`,
 * Windows-side gh.exe).
 *
 * Surface kept tiny — two pure functions:
 *   - `detectWsl()` reads `/proc/version` and looks for the "microsoft" marker
 *     (matches both WSL1 and WSL2). Returns false on macOS / native Linux.
 *   - `convertWslPath(path, direction)` rewrites between POSIX and NT spelling.
 *
 * No side effects; safe to call from anywhere.
 */
import { readFileSync } from "node:fs";

/**
 * Direction for `convertWslPath`.
 * - `to-windows`: `/mnt/c/Users/foo` -> `C:\Users\foo`
 * - `to-wsl`:     `C:\Users\foo`     -> `/mnt/c/Users/foo`
 */
export type WslPathDirection = "to-windows" | "to-wsl";

const PROC_VERSION = "/proc/version";

let cachedDetection: boolean | null = null;

/**
 * Detect whether the current process is running inside WSL (1 or 2).
 *
 * Uses `/proc/version` because the kernel string contains "Microsoft" on WSL1
 * and "microsoft" on WSL2 — both checked case-insensitively. Result is cached
 * for the process lifetime (the kernel doesn't change between calls).
 *
 * `forceRefresh` is provided for tests so they can re-evaluate after mocking
 * the filesystem.
 */
export function detectWsl(forceRefresh = false): boolean {
	if (!forceRefresh && cachedDetection !== null) {
		return cachedDetection;
	}
	try {
		const contents = readFileSync(PROC_VERSION, "utf-8");
		cachedDetection = /microsoft/i.test(contents);
	} catch {
		// Non-Linux platforms (macOS, Windows native) have no /proc/version.
		cachedDetection = false;
	}
	return cachedDetection;
}

/**
 * Reset the cached WSL detection. Test-only helper.
 */
export function _resetWslCache(): void {
	cachedDetection = null;
}

/**
 * Convert a path between WSL and Windows representations.
 *
 * Handles the common `/mnt/<letter>/...` mapping. Paths that do not match a
 * known shape are returned unchanged, so callers can safely pipe arbitrary
 * paths through.
 */
export function convertWslPath(
	path: string,
	direction: WslPathDirection,
): string {
	if (typeof path !== "string" || path.length === 0) {
		return path;
	}

	if (direction === "to-windows") {
		// `/mnt/c/Users/foo` -> `C:\Users\foo`
		const m = path.match(/^\/mnt\/([a-z])(\/.*)?$/i);
		if (!m) return path;
		const drive = m[1].toUpperCase();
		const rest = (m[2] ?? "").replace(/\//g, "\\");
		return `${drive}:${rest}`;
	}

	// to-wsl
	// `C:\Users\foo` or `C:/Users/foo` -> `/mnt/c/Users/foo`
	const m = path.match(/^([A-Za-z]):[\\/](.*)$/);
	if (!m) return path;
	const drive = m[1].toLowerCase();
	const rest = m[2].replace(/\\/g, "/");
	return `/mnt/${drive}/${rest}`;
}
