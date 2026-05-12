/**
 * Path resolution utilities following XDG Base Directory Specification.
 * Provides consistent config/state/cache paths across platforms.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** Default config directory name when XDG is not set */
const DEFAULT_CONFIG_DIR = ".apohara";

/** Default state directory name */
const DEFAULT_STATE_DIR = ".apohara";

/** Default cache directory name */
const DEFAULT_CACHE_DIR = ".apohara/cache";

/**
 * Resolves the configuration directory path.
 * Follows XDG Base Directory Specification:
 * - Uses XDG_CONFIG_HOME if set and writable
 * - Falls back to ~/.apohara/ otherwise
 */
export function getConfigDir(): string {
	const xdgConfig = process.env.XDG_CONFIG_HOME;

	if (xdgConfig) {
		const resolved = path.resolve(xdgConfig);
		try {
			// Check if XDG_CONFIG_HOME is writable
			fs.accessSync(resolved, fs.constants.W_OK);
			console.log(`[paths] Using XDG_CONFIG_HOME: ${resolved}`);
			return path.join(resolved, "apohara");
		} catch {
			console.log(
				`[paths] XDG_CONFIG_HOME not writable, falling back to default`,
			);
		}
	}

	// Fallback to ~/.apohara/
	const homeDir = os.homedir();
	const configDir = path.join(homeDir, DEFAULT_CONFIG_DIR);
	console.log(`[paths] Using default config dir: ${configDir}`);
	return configDir;
}

/**
 * Resolves the state directory path (for runtime data).
 */
export function getStateDir(): string {
	const xdgState = process.env.XDG_STATE_HOME;

	if (xdgState) {
		const resolved = path.resolve(xdgState);
		try {
			fs.accessSync(resolved, fs.constants.W_OK);
			console.log(`[paths] Using XDG_STATE_HOME: ${resolved}`);
			return path.join(resolved, "apohara");
		} catch {
			console.log(
				`[paths] XDG_STATE_HOME not writable, falling back to default`,
			);
		}
	}

	const homeDir = os.homedir();
	const stateDir = path.join(homeDir, DEFAULT_STATE_DIR);
	console.log(`[paths] Using default state dir: ${stateDir}`);
	return stateDir;
}

/**
 * Resolves the cache directory path.
 */
export function getCacheDir(): string {
	const xdgCache = process.env.XDG_CACHE_HOME;

	if (xdgCache) {
		const resolved = path.resolve(xdgCache);
		try {
			fs.accessSync(resolved, fs.constants.W_OK);
			console.log(`[paths] Using XDG_CACHE_HOME: ${resolved}`);
			return path.join(resolved, "apohara");
		} catch {
			console.log(
				`[paths] XDG_CACHE_HOME not writable, falling back to default`,
			);
		}
	}

	const homeDir = os.homedir();
	const cacheDir = path.join(homeDir, DEFAULT_CACHE_DIR);
	console.log(`[paths] Using default cache dir: ${cacheDir}`);
	return cacheDir;
}

/**
 * Ensures a directory exists, creating it if necessary.
 * Logs any permission errors.
 */
export function ensureDir(dirPath: string): boolean {
	try {
		fs.mkdirSync(dirPath, { recursive: true, mode: 0o755 });
		return true;
	} catch (err) {
		console.error(`[paths] Failed to create directory ${dirPath}:`, err);
		return false;
	}
}

/**
 * Gets the path to the credentials file.
 */
export function getCredentialsPath(): string {
	return path.join(getConfigDir(), "credentials.json");
}

/**
 * Gets the path to the config file.
 */
export function getConfigPath(): string {
	return path.join(getConfigDir(), "config.json");
}

/**
 * Shows all resolved paths (for --show-paths option).
 */
export function showPaths(): void {
	console.log("Apohara Paths:");
	console.log(`  Config: ${getConfigDir()}`);
	console.log(`  State:  ${getStateDir()}`);
	console.log(`  Cache:  ${getCacheDir()}`);
	console.log(`  Credentials: ${getCredentialsPath()}`);
	console.log(`  Config file: ${getConfigPath()}`);
}
