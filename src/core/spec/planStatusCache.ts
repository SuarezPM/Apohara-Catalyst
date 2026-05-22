/**
 * Plan status cache per spec §6.2.
 *
 * Caches PlanDocument by filepath. Avoids full reparse on:
 * - Unchanged mtime (fast path)
 * - Changed mtime but unchanged SHA of first 4KB (the frontmatter region)
 *   → just refresh mtime in cache
 *
 * Only does a full parse when SHA changes (body or frontmatter changed).
 */

import { stat, open } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parsePlanDocument, type PlanDocument } from "./planDocuments";

interface CacheEntry {
  plan: PlanDocument;
  mtimeMs: number;
  sha: string;
}

const BOUNDED_READ_BYTES = 4096;

export class PlanStatusCache {
  private cache = new Map<string, CacheEntry>();
  private _parseCount = 0;

  async getFast(filepath: string): Promise<PlanDocument> {
    const st = await stat(filepath);
    const cached = this.cache.get(filepath);

    if (cached && cached.mtimeMs === st.mtimeMs) {
      return cached.plan;
    }

    const sha = await this.boundedSha(filepath);

    if (cached && cached.sha === sha) {
      cached.mtimeMs = st.mtimeMs;
      return cached.plan;
    }

    const plan = await parsePlanDocument(filepath);
    this._parseCount += 1;
    this.cache.set(filepath, { plan, mtimeMs: st.mtimeMs, sha });
    return plan;
  }

  private async boundedSha(filepath: string): Promise<string> {
    const fh = await open(filepath, "r");
    try {
      const buf = Buffer.alloc(BOUNDED_READ_BYTES);
      const { bytesRead } = await fh.read(buf, 0, BOUNDED_READ_BYTES, 0);
      return createHash("sha256").update(buf.subarray(0, bytesRead)).digest("hex");
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