import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isWorkspaceYoloAllowed } from "../../../src/core/orchestration/yolo-allowlist";

let dir: string;
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "apohara-yolo-"));
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

test("returns false when allowlist marker missing", async () => {
	expect(await isWorkspaceYoloAllowed(dir)).toBe(false);
});

test("returns true when .apohara/yolo-allowed marker exists", async () => {
	await mkdir(join(dir, ".apohara"), { recursive: true });
	await writeFile(join(dir, ".apohara", "yolo-allowed"), "yes");
	expect(await isWorkspaceYoloAllowed(dir)).toBe(true);
});

test("returns false when marker is empty (must have non-empty content)", async () => {
	await mkdir(join(dir, ".apohara"), { recursive: true });
	await writeFile(join(dir, ".apohara", "yolo-allowed"), "");
	expect(await isWorkspaceYoloAllowed(dir)).toBe(false);
});
