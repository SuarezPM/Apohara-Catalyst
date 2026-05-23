import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSettings } from "../../../src/core/safety/settingsHierarchy";

let dir: string;
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "apohara-settings-ver-"));
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

test("settings.json without schema_version is treated as v1 and migrated", async () => {
	const p = join(dir, "settings.json");
	// Pre-v1 settings (legacy): no schema_version, top-level `cli` key.
	await writeFile(
		p,
		JSON.stringify({ cli: "claude-code-cli", max_concurrent: 3 }),
	);
	const settings = await loadSettings(p);
	expect(settings.schema_version).toBeGreaterThanOrEqual(2);
	expect((settings as any).provider).toBe("claude-code-cli");
});

test("settings.json already at v2 passes through unchanged", async () => {
	const p = join(dir, "settings.json");
	await writeFile(
		p,
		JSON.stringify({ schema_version: 2, provider: "codex-cli" }),
	);
	const settings = await loadSettings(p);
	expect(settings.schema_version).toBe(2);
	expect((settings as any).provider).toBe("codex-cli");
});

test("legacy promotion writes .bak with original v1 form", async () => {
	const p = join(dir, "settings.json");
	await writeFile(p, JSON.stringify({ cli: "opencode-go" }));
	await loadSettings(p);
	// After migration v1→v2, a .bak with the v1 snapshot must exist.
	// `loadConfigWithMigration` writes the .bak via `rename(path, path + ".bak")`
	// so the snapshot is whatever we left on disk at v1 (the auto-promoted form).
	const bak = JSON.parse(await readFile(p + ".bak", "utf-8"));
	expect(bak.schema_version).toBe(1);
	expect(bak.cli).toBe("opencode-go");
});
