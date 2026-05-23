import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfigWithMigration } from "../../../src/core/config/versioning";

let dir: string;
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "apohara-config-ver-"));
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

test("loads v2 config without migration", async () => {
	const p = join(dir, "config.json");
	await writeFile(
		p,
		JSON.stringify({ schema_version: 2, provider: "claude-code-cli" }),
	);
	const cfg = await loadConfigWithMigration(p, /*targetVersion=*/ 2);
	expect(cfg.schema_version).toBe(2);
	expect((cfg as any).provider).toBe("claude-code-cli");
});

test("migrates v1 config to v2 (renames provider key)", async () => {
	const p = join(dir, "config.json");
	await writeFile(
		p,
		JSON.stringify({ schema_version: 1, cli: "claude-code-cli" }),
	);
	const cfg = await loadConfigWithMigration(p, /*targetVersion=*/ 2);
	expect(cfg.schema_version).toBe(2);
	expect((cfg as any).provider).toBe("claude-code-cli");
	const bak = await readFile(p + ".bak", "utf-8");
	expect(bak).toContain('"schema_version":1');
});

test("rejects unknown future version", async () => {
	const p = join(dir, "config.json");
	await writeFile(p, JSON.stringify({ schema_version: 999 }));
	await expect(loadConfigWithMigration(p, 2)).rejects.toThrow(
		/schema_version 999/,
	);
});

test("rejects config missing schema_version", async () => {
	const p = join(dir, "config.json");
	await writeFile(p, JSON.stringify({ provider: "claude-code-cli" }));
	await expect(loadConfigWithMigration(p, 2)).rejects.toThrow(
		/missing or invalid schema_version/,
	);
});

test("rejects config with non-numeric schema_version", async () => {
	const p = join(dir, "config.json");
	await writeFile(
		p,
		JSON.stringify({ schema_version: "2", provider: "claude-code-cli" }),
	);
	await expect(loadConfigWithMigration(p, 2)).rejects.toThrow(
		/missing or invalid schema_version/,
	);
});
