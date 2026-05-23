import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	cacheLayout,
	pruneOldVersions,
	sha256OfFile,
} from "../../npx-cli/src/cache";

let originalHome: string | undefined;
let fakeHome: string;

beforeEach(async () => {
	originalHome = process.env.HOME;
	fakeHome = await mkdtemp(join(tmpdir(), "apohara-npx-cache-"));
	process.env.HOME = fakeHome;
});
afterEach(async () => {
	if (originalHome === undefined) delete process.env.HOME;
	else process.env.HOME = originalHome;
	await rm(fakeHome, { recursive: true, force: true });
});

test("cacheLayout points under $HOME/.apohara/bin", () => {
	const layout = cacheLayout();
	expect(layout.root).toBe(join(fakeHome, ".apohara", "bin"));
	expect(layout.versionDir("1.2.3")).toBe(
		join(fakeHome, ".apohara", "bin", "1.2.3", layout.platform),
	);
});

test("sha256OfFile produces the canonical hex digest", async () => {
	const f = join(fakeHome, "f.txt");
	await writeFile(f, "hello\n");
	expect(await sha256OfFile(f)).toBe(
		// echo "hello" | sha256sum  →  5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03
		"5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03",
	);
});

test("pruneOldVersions keeps only the named version", async () => {
	const layout = cacheLayout();
	for (const v of ["0.9.0", "1.0.0", "1.1.0"]) {
		const dir = layout.versionDir(v);
		await rm(dir, { recursive: true, force: true });
		await Bun.write(join(dir, "stamp"), v);
	}
	await pruneOldVersions("1.1.0");
	// Both old versions should be gone, the kept one survives.
	const fs = await import("node:fs/promises");
	const remaining = await fs.readdir(layout.root);
	expect(remaining).toEqual(["1.1.0"]);
});
