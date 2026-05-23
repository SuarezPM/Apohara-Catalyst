import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverConfigChain } from "../../../src/core/config/decentralized-discovery";

let root: string;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "apohara-discover-"));
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

test("discovers configs walking up directory tree", async () => {
	await mkdir(join(root, "a", "b"), { recursive: true });
	await writeFile(join(root, ".apohara.json"), JSON.stringify({ level: "root" }));
	await writeFile(join(root, "a", ".apohara.json"), JSON.stringify({ level: "mid" }));
	const chain = await discoverConfigChain(join(root, "a", "b"));
	expect(chain.map((c) => c.config.level)).toEqual(["root", "mid"]);
});

test("returns empty chain when no config found", async () => {
	await mkdir(join(root, "empty"), { recursive: true });
	const chain = await discoverConfigChain(join(root, "empty"));
	expect(chain).toEqual([]);
});
