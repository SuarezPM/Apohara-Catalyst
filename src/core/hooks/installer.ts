/**
 * Hook script installer per spec §3.5.
 *
 * Idempotent: skips write if existing file content matches (SHA-256 hash).
 * Atomic: `atomicWriteFile` swaps the new content in via temp-then-rename
 * so a crash mid-write cannot leave a partial hook script that breaks
 * the next permission gate. Existing differing content is backed up
 * BEFORE the new content lands, so a backup is always present whenever
 * we overwrite.
 * Chmod 755 on POSIX so the CLI can exec the script.
 */
import { readFile, stat, rename, chmod, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, basename, join } from "node:path";
import { atomicWriteFile } from "../persistence/atomicWrite";

export function computeHookHash(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

export interface InstallResult {
	installed: boolean;
	reason: "wrote_new" | "overwrote_with_backup" | "skipped_hash_match";
	backupPath?: string;
}

async function pathExists(p: string): Promise<boolean> {
	try {
		await stat(p);
		return true;
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw e;
	}
}

export async function installHook(
	targetPath: string,
	scriptContent: string,
): Promise<InstallResult> {
	await mkdir(dirname(targetPath), { recursive: true });

	let existing: string | null = null;
	try {
		existing = await readFile(targetPath, "utf-8");
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
	}

	if (existing !== null) {
		if (computeHookHash(existing) === computeHookHash(scriptContent)) {
			return { installed: false, reason: "skipped_hash_match" };
		}
		// Move existing aside FIRST so a backup is always present on disk
		// even if the atomic write fails partway through. atomicWriteFile
		// then writes the new content into a fresh temp + rename.
		const backupPath = join(
			dirname(targetPath),
			`${basename(targetPath)}.bak.${Date.now()}`,
		);
		await rename(targetPath, backupPath);
		try {
			await atomicWriteFile(targetPath, scriptContent);
			if (process.platform !== "win32" && targetPath.endsWith(".sh")) {
				await chmod(targetPath, 0o755);
			}
		} catch (err) {
			// Restore the backup if the new write failed, to leave the user
			// with the original hook rather than a missing file.
			if (await pathExists(backupPath)) {
				await rename(backupPath, targetPath).catch(() => {});
			}
			throw err;
		}
		return { installed: true, reason: "overwrote_with_backup", backupPath };
	}

	await atomicWriteFile(targetPath, scriptContent);
	if (process.platform !== "win32" && targetPath.endsWith(".sh")) {
		await chmod(targetPath, 0o755);
	}
	return { installed: true, reason: "wrote_new" };
}
