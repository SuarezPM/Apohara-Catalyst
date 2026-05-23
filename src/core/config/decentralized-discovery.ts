/**
 * culture #9 — walk up the directory tree collecting .apohara.json
 * configs. Order: root → leaf (most-specific wins on merge). Each
 * level can override or extend the parent.
 */
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export interface ConfigLevel {
	path: string;
	config: Record<string, unknown>;
}

export async function discoverConfigChain(startDir: string): Promise<ConfigLevel[]> {
	const found: ConfigLevel[] = [];
	let cur = resolve(startDir);
	while (true) {
		const candidate = join(cur, ".apohara.json");
		try {
			const raw = await readFile(candidate, "utf-8");
			found.unshift({ path: candidate, config: JSON.parse(raw) });
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
		}
		const parent = dirname(cur);
		if (parent === cur) break; // reached filesystem root
		cur = parent;
	}
	return found;
}
