/**
 * Hook script installer.
 *
 * `installHooksForProvider(providerId, opts?)` writes the matching
 * shell script from `scripts.ts` to its agent-specific path,
 * `chmod +x`'s it, and returns the install record. Re-installing is
 * idempotent: existing scripts with matching content are left alone;
 * differing ones are backed up before overwriting (mirrors the
 * `core/hooks/installer.ts` pattern that also covers Apohara's
 * agent-hooks).
 *
 * `installAllHooks()` walks every entry in `getHookScripts()` and
 * installs each one. Best-effort: a missing parent dir, e.g. the user
 * doesn't have claude installed and there's no `~/.claude/`, is
 * reported via the result record rather than thrown.
 */
import { chmod, mkdir, readFile, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, basename, join } from "node:path";
import { atomicWriteFile } from "../persistence/atomicWrite.js";
import { getHookScripts, type HookScriptDescriptor } from "./scripts.js";

export type InstallStatus =
	| "installed"
	| "skipped_existing"
	| "overwrote_with_backup"
	| "failed";

export interface InstallResult {
	provider: string;
	path: string;
	status: InstallStatus;
	backupPath?: string;
	error?: string;
}

function hash(s: string): string {
	return createHash("sha256").update(s).digest("hex");
}

async function installOne(
	descriptor: HookScriptDescriptor,
	targetPath: string,
): Promise<InstallResult> {
	try {
		await mkdir(dirname(targetPath), { recursive: true });

		let existing: string | null = null;
		try {
			existing = await readFile(targetPath, "utf-8");
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
		}

		if (existing !== null) {
			if (hash(existing) === hash(descriptor.body)) {
				return {
					provider: descriptor.provider,
					path: targetPath,
					status: "skipped_existing",
				};
			}
			const backupPath = join(
				dirname(targetPath),
				`${basename(targetPath)}.bak.${Date.now()}`,
			);
			await rename(targetPath, backupPath);
			await atomicWriteFile(targetPath, descriptor.body);
			if (process.platform !== "win32") {
				await chmod(targetPath, 0o755);
			}
			return {
				provider: descriptor.provider,
				path: targetPath,
				status: "overwrote_with_backup",
				backupPath,
			};
		}

		await atomicWriteFile(targetPath, descriptor.body);
		if (process.platform !== "win32") {
			await chmod(targetPath, 0o755);
		}
		return {
			provider: descriptor.provider,
			path: targetPath,
			status: "installed",
		};
	} catch (err) {
		return {
			provider: descriptor.provider,
			path: targetPath,
			status: "failed",
			error: (err as Error).message,
		};
	}
}

export interface InstallOptions {
	/** Override the default install path for testing. */
	installPath?: string;
}

export async function installHooksForProvider(
	providerId: string,
	opts: InstallOptions = {},
): Promise<InstallResult | null> {
	const descriptor = getHookScripts().find((s) => s.provider === providerId);
	if (!descriptor) return null;
	return installOne(descriptor, opts.installPath ?? descriptor.defaultInstallPath);
}

export async function installAllHooks(): Promise<InstallResult[]> {
	const out: InstallResult[] = [];
	for (const d of getHookScripts()) {
		out.push(await installOne(d, d.defaultInstallPath));
	}
	return out;
}
