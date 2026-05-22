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
		return plan;
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