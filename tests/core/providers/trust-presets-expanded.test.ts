import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyTrust } from "../../../src/core/providers/trust-presets";

let fakeHome: string;
let originalHome: string | undefined;

beforeEach(async () => {
	originalHome = process.env.HOME;
	fakeHome = await mkdtemp(join(tmpdir(), "apohara-trust-test-"));
	process.env.HOME = fakeHome;
});

afterEach(async () => {
	if (originalHome === undefined) {
		delete process.env.HOME;
	} else {
		process.env.HOME = originalHome;
	}
	await rm(fakeHome, { recursive: true, force: true });
});

test("cursor: writes .cursor/projects/<slug>/.workspace-trusted", async () => {
	await applyTrust("cursor", "/Users/pablo/projects/apohara");
	const slug = "Users-pablo-projects-apohara";
	const f = join(fakeHome, ".cursor", "projects", slug, ".workspace-trusted");
	expect(existsSync(f)).toBe(true);
	const body = JSON.parse(await readFile(f, "utf-8"));
	expect(body.workspacePath).toBe("/Users/pablo/projects/apohara");
	expect(typeof body.trustedAt).toBe("string");
});

test("copilot: appends to ~/.copilot/config.json trustedFolders array", async () => {
	await applyTrust("copilot", "/tmp/workspace-a");
	await applyTrust("copilot", "/tmp/workspace-b");
	// Re-applying the same one shouldn't duplicate.
	await applyTrust("copilot", "/tmp/workspace-a");
	const config = JSON.parse(
		await readFile(join(fakeHome, ".copilot", "config.json"), "utf-8"),
	);
	expect(config.trustedFolders).toEqual(["/tmp/workspace-a", "/tmp/workspace-b"]);
});

test("aider: writes ~/.aider/projects.json with auto_confirm:true", async () => {
	await applyTrust("aider", "/tmp/x");
	const proj = JSON.parse(
		await readFile(join(fakeHome, ".aider", "projects.json"), "utf-8"),
	);
	expect(proj["/tmp/x"].auto_confirm).toBe(true);
});

test("aider: idempotent — second call doesn't change file", async () => {
	await applyTrust("aider", "/tmp/x");
	const f = join(fakeHome, ".aider", "projects.json");
	const v1 = await readFile(f, "utf-8");
	await applyTrust("aider", "/tmp/x");
	const v2 = await readFile(f, "utf-8");
	expect(v2).toBe(v1);
});

test("copilot: refuses to overwrite a corrupted config.json", async () => {
	const f = join(fakeHome, ".copilot", "config.json");
	await Bun.write(f, "not json at all");
	await applyTrust("copilot", "/tmp/y");
	expect(await readFile(f, "utf-8")).toBe("not json at all");
});
