/**
 * Atomic file write per spec §0.8.
 *
 * Pattern: open a sibling temp file, write, `fdatasync()` so the file's
 * data pages are flushed to disk, close, then `rename()` to the target.
 * `rename(2)` on the same filesystem is atomic, but the directory entry
 * being atomic is not enough — without an explicit fsync of the tmp
 * file the kernel can keep page-cache-only data and a power loss
 * between rename and writeback yields a zero-length post-rename file
 * even though the rename succeeded.
 *
 * Bun does not yet expose `mkstemp`, so we generate a tmp name with
 * `crypto.randomUUID()`.
 */
import { mkdir, open, rename, unlink } from "node:fs/promises";
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
	let fh: Awaited<ReturnType<typeof open>> | null = null;
	try {
		fh = await open(tmpPath, "w", 0o600);
		const buf =
			typeof content === "string" ? Buffer.from(content, "utf-8") : content;
		await fh.writeFile(buf);
		// Flush data pages BEFORE the rename so a crash between the two
		// system calls can't leave a zero-length post-rename file.
		await fh.datasync();
		await fh.close();
		fh = null;
		await rename(tmpPath, targetPath);
	} catch (err) {
		// Best-effort cleanup
		if (fh) {
			await fh.close().catch(() => {});
		}
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
