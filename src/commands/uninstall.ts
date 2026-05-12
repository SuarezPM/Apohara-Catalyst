import * as fsSync from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Command } from "commander";
import { getCacheDir, getConfigDir, getStateDir } from "../lib/paths.js";

/**
 * Prompts for confirmation.
 */
async function confirm(label: string, defaultYes = false): Promise<boolean> {
	const readline = await import("node:readline/promises");
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	const suffix = defaultYes ? " [Y/n]" : " [y/N]";
	try {
		const answer = await rl.question(`${label}${suffix}: `);
		const normalized = answer.trim().toLowerCase();
		if (!normalized) return defaultYes;
		return normalized === "y" || normalized === "yes";
	} finally {
		rl.close();
	}
}

/**
 * Checks if a directory exists.
 */
async function dirExists(dirPath: string): Promise<boolean> {
	try {
		await fs.access(dirPath);
		const stat = await fs.stat(dirPath);
		return stat.isDirectory();
	} catch {
		return false;
	}
}

/**
 * Checks if the package is installed globally via npm.
 */
async function isNpmInstalled(): Promise<boolean> {
	try {
		const { execSync } = await import("node:child_process");
		execSync("npm list -g --depth=0 apohara", {
			stdio: "pipe",
			encoding: "utf-8",
		});
		return true;
	} catch {
		return false;
	}
}

/**
 * Removes a directory if it exists.
 */
async function removeDir(dirPath: string, label: string): Promise<boolean> {
	const exists = await dirExists(dirPath);
	if (!exists) {
		console.log(`  ⏭️  ${label} not found, skipping`);
		return true;
	}

	try {
		await fs.rm(dirPath, { recursive: true, force: true });
		console.log(`  ✅ Removed ${label}`);
		return true;
	} catch (err) {
		console.error(`  ❌ Failed to remove ${label}:`, err);
		return false;
	}
}

/**
 * Detects shell rc files and removes apohara from PATH.
 */
async function removeFromPath(): Promise<boolean> {
	const homeDir = os.homedir();
	const shell = process.env.SHELL || "";
	const isBash = shell.includes("bash");
	const isZsh = shell.includes("zsh");

	// Shell rc files to check
	const rcFiles = [
		".bashrc",
		".bash_profile",
		".profile",
		".zshrc",
		".zprofile",
	];

	let removedAny = false;

	for (const rcFile of rcFiles) {
		const rcPath = path.join(homeDir, rcFile);

		try {
			await fs.access(rcPath);
			let content = await fs.readFile(rcPath, "utf-8");

			// Check if this file contains apohara PATH export
			const hasApoharaExport =
				content.includes('export PATH=".*apohara.*"') ||
				content.includes("apohara/bin") ||
				content.includes("apohara/bin");

			if (!hasApoharaExport) {
				continue;
			}

			// Remove apohara-related PATH modifications
			const lines = content.split("\n");
			const filteredLines = lines.filter((line) => {
				// Skip lines that add apohara to PATH
				if (line.includes("apohara/bin")) {
					return false;
				}
				// Skip lines that source apohara init scripts
				if (line.includes("apohara") && line.includes("source")) {
					return false;
				}
				return true;
			});

			content = filteredLines.join("\n");

			// Only write if content changed
			if (content !== lines.join("\n")) {
				await fs.writeFile(rcPath, content, "utf-8");
				console.log(`  ✅ Updated ${rcFile} to remove apohara from PATH`);
				removedAny = true;
			}
		} catch {
			// File doesn't exist or can't be read, skip
		}
	}

	if (!removedAny) {
		console.log("  ⏭️  No PATH modifications found in shell config");
	}

	return true;
}

/**
 * Removes npm global package.
 */
async function removeNpmPackage(): Promise<boolean> {
	const installed = await isNpmInstalled();
	if (!installed) {
		console.log("  ⏭️  npm global package not found, skipping");
		return true;
	}

	try {
		const { execSync } = await import("node:child_process");
		execSync("npm uninstall -g apohara", {
			stdio: "inherit",
			encoding: "utf-8",
		});
		console.log("  ✅ Removed npm global package");
		return true;
	} catch (err) {
		console.error("  ❌ Failed to remove npm package:", err);
		return false;
	}
}

/**
 * Shows what will be removed without actually removing anything.
 */
async function showWhatWillBeRemoved(): Promise<void> {
	console.log("\n📋 The following will be removed:");
	console.log("");

	// Config directories
	const configDir = getConfigDir();
	const configExists = await dirExists(configDir);
	console.log(
		`  • Config directory: ${configDir}${configExists ? " (exists)" : ""}`,
	);

	const stateDir = getStateDir();
	const stateExists = await dirExists(stateDir);
	console.log(
		`  • State directory: ${stateDir}${stateExists ? " (exists)" : ""}`,
	);

	const cacheDir = getCacheDir();
	const cacheExists = await dirExists(cacheDir);
	console.log(
		`  • Cache directory: ${cacheDir}${cacheExists ? " (exists)" : ""}`,
	);

	// npm package
	const npmInstalled = await isNpmInstalled();
	console.log(
		`  • npm global package: ${npmInstalled ? "installed" : "not installed"}`,
	);

	// Binary location
	const { execSync } = await import("node:child_process");
	try {
		const which = execSync("which apohara", { encoding: "utf-8" }).trim();
		console.log(`  • Binary location: ${which}`);
	} catch {
		console.log("  • Binary location: not in PATH");
	}

	console.log("");
}

/**
 * Main uninstall action.
 */
async function uninstall(options: {
	dryRun?: boolean;
	yes?: boolean;
}): Promise<void> {
	console.log("\n🧹 Apohara Uninstall");
	console.log("===================\n");

	// Show what will be removed
	await showWhatWillBeRemoved();

	// Confirm uninstall
	if (!options.yes) {
		const proceed = await confirm(
			"Are you sure you want to uninstall Apohara?",
			false,
		);
		if (!proceed) {
			console.log("\n❌ Uninstall cancelled.");
			return;
		}
	} else {
		console.log("⚠️  Running in non-interactive mode (--yes flag)\n");
	}

	// If dry-run, stop here
	if (options.dryRun) {
		console.log("✅ Dry run complete. No files were removed.");
		return;
	}

	console.log("Removing files...\n");

	let success = true;

	// Remove config directory
	if (!(await removeDir(getConfigDir(), "Config directory"))) {
		success = false;
	}

	// Remove state directory (if different from config)
	const stateDir = getStateDir();
	const configDir = getConfigDir();
	if (stateDir !== configDir) {
		if (!(await removeDir(stateDir, "State directory"))) {
			success = false;
		}
	}

	// Remove cache directory (if different from config)
	const cacheDir = getCacheDir();
	if (cacheDir !== configDir) {
		if (!(await removeDir(cacheDir, "Cache directory"))) {
			success = false;
		}
	}

	// Remove from PATH
	console.log("");
	if (!(await removeFromPath())) {
		success = false;
	}

	// Remove npm package
	console.log("");
	if (!(await removeNpmPackage())) {
		success = false;
	}

	console.log("");
	if (success) {
		console.log("✅ Uninstall complete!");
		console.log(
			"\n📝 Note: You may need to restart your terminal for PATH changes to take effect.",
		);
	} else {
		console.log(
			"⚠️  Uninstall completed with errors. Please review the output above.",
		);
	}
}

export const uninstallCommand = new Command("uninstall")
	.description("Uninstall Apohara (removes config, binaries, and npm package)")
	.option("-y, --yes", "Skip confirmation prompt", false)
	.option(
		"--dry-run",
		"Show what will be removed without actually removing anything",
		false,
	)
	.action(async (options: { yes?: boolean; dryRun?: boolean }) => {
		await uninstall(options);
	});
