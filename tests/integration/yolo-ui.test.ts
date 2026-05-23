import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isWorkspaceYoloAllowed } from "../../src/core/orchestration/yolo-allowlist";

let workspace: string;
beforeEach(async () => {
	workspace = await mkdtemp(join(tmpdir(), "apohara-yolo-ui-"));
});
afterEach(async () => {
	await rm(workspace, { recursive: true, force: true });
});

test("user creates allowlist file with non-empty content", async () => {
	await mkdir(join(workspace, ".apohara"), { recursive: true });
	await writeFile(join(workspace, ".apohara", "yolo-allowed"), "approved by user 2026-05-22");
	expect(await isWorkspaceYoloAllowed(workspace)).toBe(true);
});

test("revoking allowlist disables yolo", async () => {
	await mkdir(join(workspace, ".apohara"), { recursive: true });
	await writeFile(join(workspace, ".apohara", "yolo-allowed"), "approved");
	expect(await isWorkspaceYoloAllowed(workspace)).toBe(true);
	await rm(join(workspace, ".apohara", "yolo-allowed"));
	expect(await isWorkspaceYoloAllowed(workspace)).toBe(false);
});
