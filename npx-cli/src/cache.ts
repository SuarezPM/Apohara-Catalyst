/**
 * Per-version binary cache under `~/.apohara/bin/<version>/<platform>/`.
 * Each binary is sha256-verified before becoming "current". Old
 * versions are pruned AFTER the new one is in place (atomic upgrade
 * — vibe-kanban pattern, `npx-cli/src/download.ts`).
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { binaryName, detectPlatformSlug, type PlatformSlug } from "./platform.js";

export interface CacheLayout {
	root: string;
	versionDir: (version: string) => string;
	binaryPath: (version: string) => string;
	platform: PlatformSlug;
}

export function cacheLayout(): CacheLayout {
	const platform = detectPlatformSlug();
	// $HOME wins over homedir() so test harnesses that mkdtemp a fake
	// home can redirect the cache without monkey-patching the os module.
	const home = process.env.HOME ?? homedir();
	const root = join(home, ".apohara", "bin");
	return {
		root,
		platform,
		versionDir: (version) => join(root, version, platform),
		binaryPath: (version) => join(root, version, platform, binaryName()),
	};
}

export async function ensureCacheDir(version: string): Promise<string> {
	const layout = cacheLayout();
	const dir = layout.versionDir(version);
	await mkdir(dir, { recursive: true });
	return dir;
}

export function isBinaryCached(version: string): boolean {
	return existsSync(cacheLayout().binaryPath(version));
}

export async function sha256OfFile(path: string): Promise<string> {
	const buf = await readFile(path);
	return createHash("sha256").update(buf).digest("hex");
}

/**
 * Drop every cached version EXCEPT `keep`. Only runs once we know
 * `keep` is fully present + verified — vibe-kanban's "atomic upgrade"
 * invariant. Misses are best-effort: a partial cleanup beats failing
 * the launch on a single locked file.
 */
export async function pruneOldVersions(keep: string): Promise<void> {
	const layout = cacheLayout();
	if (!existsSync(layout.root)) return;
	const entries = await readdir(layout.root);
	for (const v of entries) {
		if (v === keep) continue;
		await rm(join(layout.root, v), { recursive: true, force: true }).catch(
			() => {
				/* swallow */
			},
		);
	}
}
