#!/usr/bin/env node

/**
 * Postinstall script for apohara npm package.
 * Extracts the correct platform-specific binary from optionalDependencies.
 * Works as both ESM and CommonJS.
 */

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { arch, platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ESM-compatible way to get the directory of this script.
// Uses node:url's fileURLToPath so `file:///D:/...` URLs on Windows
// are normalized to native `D:\...` paths before passing to fs.
const getScriptDir = () => {
	if (typeof import.meta !== "undefined" && import.meta.url) {
		return dirname(fileURLToPath(import.meta.url));
	}
	try {
		const require = createRequire(import.meta.url || __filename);
		return dirname(require.main?.filename || __filename);
	} catch {
		return dirname(__filename);
	}
};

const platformMap = {
	darwin: "darwin",
	linux: "linux",
	win32: "win32",
};

const archMap = {
	x64: "x64",
	arm64: "arm64",
};

const currentPlatform = platformMap[platform()] || "linux";
const currentArch = archMap[arch()] || "x64";
const packageName = `@apohara/cli-${currentPlatform}-${currentArch}`;

const scriptDir = getScriptDir();
const binariesDir = join(scriptDir, "..", "binaries");

// Ensure binaries directory exists
if (!existsSync(binariesDir)) {
	mkdirSync(binariesDir, { recursive: true });
}

// Try to find the binary in optionalDependencies
try {
	// Use createRequire to resolve the optional dependency
	const require = createRequire(import.meta.url);
	const binaryPath = require.resolve(`${packageName}/bin/apohara`);
	const destPath = join(binariesDir, "apohara");

	if (existsSync(binaryPath)) {
		copyFileSync(binaryPath, destPath);
		console.log(`✅ Extracted ${packageName} binary to binaries/`);
	}
} catch {
	// Optional dependency not available - this is fine for platforms we don't support
	console.log(
		`ℹ️  No prebuilt binary for ${currentPlatform}-${currentArch} (optional)`,
	);
}

// Create a marker file indicating this is the npm package
const markerPath = join(binariesDir, ".npm-package");
try {
	writeFileSync(markerPath, "npm-package\n");
} catch {
	// Ignore errors
}
