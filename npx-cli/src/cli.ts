#!/usr/bin/env node
/**
 * `apohara` npx shim entry point.
 *
 * Flow:
 *   1. Read the package version (the same version this shim was
 *      installed at — guarantees the binary it spawns matches).
 *   2. If `target/release/apohara-desktop` exists relative to a
 *      `Cargo.toml` parent, use the LOCAL build (dev path — avoids
 *      pulling the release binary while iterating).
 *   3. Otherwise look in the per-version cache
 *      (`~/.apohara/bin/<v>/<platform>/apohara-desktop`); if absent,
 *      download + verify via `download.ts`.
 *   4. Spawn the binary with the user's argv, inherit stdio.
 *   5. Forward the exit code.
 *
 * `--version` short-circuits — useful in CI to confirm the shim
 * resolved the right cached binary.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cacheLayout, pruneOldVersions } from "./cache.js";
import { downloadBinary } from "./download.js";
import { binaryName } from "./platform.js";

async function readSelfVersion(): Promise<string> {
	const here = dirname(fileURLToPath(import.meta.url));
	let dir = here;
	for (let i = 0; i < 8; i++) {
		const pkg = join(dir, "package.json");
		if (existsSync(pkg)) {
			try {
				const body = await readFile(pkg, "utf-8");
				const parsed = JSON.parse(body) as { version?: string };
				if (parsed.version) return parsed.version;
			} catch {
				/* try next */
			}
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	throw new Error("apohara npx shim: cannot determine its own version");
}

function findLocalBuild(): string | null {
	// Walk up from cwd looking for a Cargo workspace root with the
	// binary already built. Lets contributors `npx apohara` from the
	// repo without paying the download cost.
	let dir = process.cwd();
	for (let i = 0; i < 8; i++) {
		const cargo = join(dir, "Cargo.toml");
		if (existsSync(cargo)) {
			const local = join(dir, "target", "release", binaryName());
			if (existsSync(local)) return resolve(local);
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

async function resolveBinary(version: string): Promise<string> {
	const local = findLocalBuild();
	if (local) {
		// Local dev build wins. The user might be hacking on the
		// crate they just edited — pulling the release binary here
		// would be confusing.
		return local;
	}
	const layout = cacheLayout();
	const cached = layout.binaryPath(version);
	if (existsSync(cached)) return cached;

	process.stderr.write(
		`apohara: downloading v${version} for ${layout.platform}…\n`,
	);
	const result = await downloadBinary({ version });
	// Only prune older versions AFTER the new one is in place +
	// verified (atomic upgrade — vibe-kanban pattern).
	await pruneOldVersions(version);
	return result.binaryPath;
}

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	const version = await readSelfVersion();

	if (argv[0] === "--version" || argv[0] === "-v") {
		process.stdout.write(`apohara ${version}\n`);
		process.exit(0);
	}

	let binary: string;
	try {
		binary = await resolveBinary(version);
	} catch (err) {
		process.stderr.write(
			`apohara: failed to resolve binary: ${(err as Error).message}\n`,
		);
		process.stderr.write(
			"hint: build from source via 'cargo build --release' in the repo root.\n",
		);
		process.exit(1);
	}

	const child = spawn(binary, argv, { stdio: "inherit" });
	child.on("exit", (code) => process.exit(code ?? 0));
	child.on("error", (err) => {
		process.stderr.write(`apohara: spawn failed: ${err.message}\n`);
		process.exit(1);
	});
}

main().catch((err) => {
	process.stderr.write(`apohara: unexpected: ${(err as Error).message}\n`);
	process.exit(1);
});
