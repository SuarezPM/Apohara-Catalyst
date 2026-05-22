/**
 * Hook script installer per spec §3.5.
 *
 * Idempotent: skips write if existing file content matches (SHA-256 hash).
 * Atomic-ish: backs up existing differing file before overwrite.
 * Chmod 755 on POSIX so the CLI can exec the script.
 */
import { readFile, stat, writeFile, rename, chmod, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, basename, join } from "node:path";

export function computeHookHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export interface InstallResult {
  installed: boolean;
  reason: "wrote_new" | "overwrote_with_backup" | "skipped_hash_match";
  backupPath?: string;
}

export async function installHook(targetPath: string, scriptContent: string): Promise<InstallResult> {
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
    const backupPath = join(dirname(targetPath), `${basename(targetPath)}.bak.${Date.now()}`);
    await rename(targetPath, backupPath);
    await writeFile(targetPath, scriptContent);
    if (process.platform !== "win32" && targetPath.endsWith(".sh")) {
      await chmod(targetPath, 0o755);
    }
    return { installed: true, reason: "overwrote_with_backup", backupPath };
  }

  await writeFile(targetPath, scriptContent);
  if (process.platform !== "win32" && targetPath.endsWith(".sh")) {
    await chmod(targetPath, 0o755);
  }
  return { installed: true, reason: "wrote_new" };
}