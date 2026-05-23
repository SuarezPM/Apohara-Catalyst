/**
 * Plan status cache per spec §6.2.
 *
 * Caches PlanDocument by filepath. Avoids full reparse on:
 * - Unchanged mtime + unchanged size (fast path)
 * - Changed mtime but unchanged full-file SHA → just refresh mtime/size
 *
 * Only does a full parse when SHA changes. Previously the SHA was
 * computed over the first 4 KB of the file ("frontmatter region"), which
 * silently returned stale plans whenever an edit lived past byte 4096
 * — common for any non-trivial plan. The fix is to hash the entire
 * file. The size + mtime fast-path stays in place so the hash is only
 * computed when the file has actually been touched.
 *
 * G5.G.2 — Last-known-good fallback. When `getFastOrLkg` is called and
 * the underlying file fails to parse, the cache returns the previous
 * successful parse instead of propagating the error. The watcher uses
 * this to keep consumers reading a usable plan while the writer is
 * mid-edit.
 */

import { stat, open } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parsePlanDocument, type PlanDocument } from "./planDocuments";

interface CacheEntry {
	plan: PlanDocument;
	mtimeMs: number;
	size: number;
	sha: string;
}

const HASH_CHUNK_BYTES = 64 * 1024;

export class PlanStatusCache {
	private cache = new Map<string, CacheEntry>();
	private lkg = new Map<string, PlanDocument>();
	private _parseCount = 0;

	async getFast(filepath: string): Promise<PlanDocument> {
		const st = await stat(filepath);
		const cached = this.cache.get(filepath);

		// Fast path: mtime AND size both unchanged → definitely no edit.
		if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
			return cached.plan;
		}

		const sha = await this.fileSha(filepath);

		if (cached && cached.sha === sha) {
			cached.mtimeMs = st.mtimeMs;
			cached.size = st.size;
			return cached.plan;
		}

		const plan = await parsePlanDocument(filepath);
		this._parseCount += 1;
		this.cache.set(filepath, {
			plan,
			mtimeMs: st.mtimeMs,
			size: st.size,
			sha,
		});
		this.lkg.set(filepath, plan);
		return plan;
	}

	/**
	 * Last-known-good fallback. Like `getFast`, but if the underlying
	 * parse throws (e.g. mid-edit broken YAML) and a previous successful
	 * parse exists, returns that instead of propagating the error.
	 * Throws if there is no last-known-good entry to fall back to.
	 */
	async getFastOrLkg(filepath: string): Promise<PlanDocument> {
		try {
			return await this.getFast(filepath);
		} catch (err) {
			const lkg = this.lkg.get(filepath);
			if (lkg) return lkg;
			throw err;
		}
	}

	/** Look up the last-known-good entry without forcing a parse. */
	getLastKnownGood(filepath: string): PlanDocument | undefined {
		return this.lkg.get(filepath);
	}

	private async fileSha(filepath: string): Promise<string> {
		const fh = await open(filepath, "r");
		try {
			const hash = createHash("sha256");
			const buf = Buffer.alloc(HASH_CHUNK_BYTES);
			let offset = 0;
			while (true) {
				const { bytesRead } = await fh.read(buf, 0, HASH_CHUNK_BYTES, offset);
				if (bytesRead === 0) break;
				hash.update(buf.subarray(0, bytesRead));
				offset += bytesRead;
			}
			return hash.digest("hex");
		} finally {
			await fh.close();
		}
	}

	clear(filepath: string): void {
		this.cache.delete(filepath);
	}

	size(): number {
		return this.cache.size;
	}

	parseCount(): number {
		return this._parseCount;
	}
}