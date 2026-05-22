/**
 * Atomic file write per spec §0.8.
 *
 * Pattern: write to a sibling temp file (same filesystem = atomic rename),
 * then rename to the target. On any error, clean up the temp file.
 *
 * Bun does not yet expose `mkstemp`, so we generate a tmp name with crypto.randomUUID().
 */
import { rename, unlink, writeFile, mkdir } from "node:fs/promises";
import { dirname, basename, join } from "node:path";
import { randomUUID } from "node:crypto";

export async function atomicWriteFile(
  targetPath: string,
  content: string | Uint8Array,
  options: { ensureParentDir?: boolean } = {},
): Promise<void> {
  const dir = dirname(targetPath);
  if (options.ensureParentDir) {
    await mkdir(dir, { recursive: true });
  }
  const tmpName = `.tmp.${basename(targetPath)}.${randomUUID()}`;
  const tmpPath = join(dir, tmpName);
  try {
    await writeFile(tmpPath, content);
    await rename(tmpPath, targetPath);
  } catch (err) {
    // Best-effort cleanup
    await unlink(tmpPath).catch(() => {});
    throw err;
  }
}

/**
 * Atomic JSON write with stable formatting.
 */
export async function atomicWriteJson(
  targetPath: string,
  data: unknown,
  options: { ensureParentDir?: boolean; indent?: number } = {},
): Promise<void> {
  const json = JSON.stringify(data, null, options.indent ?? 2) + "\n";
  await atomicWriteFile(targetPath, json, options);
}
