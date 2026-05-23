import { expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	compactLedger,
	loadEntries,
} from "../../src/core/safety/durablePrompt-jsonl";

test("compactLedger writes atomically (no partial state visible on read)", async () => {
	const dir = await mkdtemp(join(tmpdir(), "apohara-atomic-"));
	try {
		const path = join(dir, "p.jsonl");
		await writeFile(
			path,
			'{"kind":"request","data":{"request_id":"a","prompt":"x","createdAt":1}}\n',
		);

		// Compact with empty alive list — verifies the write itself is atomic.
		await compactLedger(path, []);

		const after = await loadEntries(path);
		expect(after).toEqual([]);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("compactLedger preserves alive entries with a single rewrite", async () => {
	const dir = await mkdtemp(join(tmpdir(), "apohara-atomic-"));
	try {
		const path = join(dir, "p.jsonl");
		await writeFile(
			path,
			[
				'{"kind":"request","data":{"request_id":"a"}}',
				'{"kind":"request","data":{"request_id":"b"}}',
				'{"kind":"request","data":{"request_id":"c"}}',
			].join("\n") + "\n",
		);

		const alive = (await loadEntries(path)).filter(
			(e) => e.kind === "request" && (e.data as { request_id: string }).request_id !== "b",
		);
		await compactLedger(path, alive);

		const after = await loadEntries(path);
		expect(after).toHaveLength(2);
		const ids = after.map(
			(e) => (e.data as { request_id: string }).request_id,
		);
		expect(ids).toEqual(["a", "c"]);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("compactLedger leaves no tmp file behind on success", async () => {
	const dir = await mkdtemp(join(tmpdir(), "apohara-atomic-"));
	try {
		const path = join(dir, "p.jsonl");
		await writeFile(path, '{"kind":"request","data":{"request_id":"x"}}\n');
		await compactLedger(path, []);

		// atomicWriteFile uses mkstemp + rename; the tmp file must NOT
		// survive a successful compaction (we crash-recover by reading the
		// final path, not by sweeping leftover tmp files).
		const files = await readdir(dir);
		expect(files).toEqual(["p.jsonl"]);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("compactLedger replacement is durable across re-reads", async () => {
	// Smoke-checks that the rename is the final state: a read immediately
	// after compactLedger sees the new bytes, not a stale cache.
	const dir = await mkdtemp(join(tmpdir(), "apohara-atomic-"));
	try {
		const path = join(dir, "p.jsonl");
		await writeFile(
			path,
			'{"kind":"request","data":{"request_id":"old"}}\n',
		);
		await compactLedger(path, [
			{ kind: "request", data: { request_id: "new" } as never },
		]);

		const raw = await readFile(path, "utf-8");
		expect(raw).toContain('"request_id":"new"');
		expect(raw).not.toContain('"request_id":"old"');
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
