import { readFile, rename } from "node:fs/promises";
import { atomicWriteJson } from "../persistence/atomicWrite.js";

export type ConfigV1 = { schema_version: 1; cli?: string };
export type ConfigV2 = { schema_version: 2; provider?: string };
export type AnyVersionedConfig = ConfigV1 | ConfigV2;

type Migration = (input: AnyVersionedConfig) => AnyVersionedConfig;

const MIGRATIONS: Record<number, Migration> = {
	1: (cfg) => {
		const v1 = cfg as ConfigV1;
		return { schema_version: 2, provider: v1.cli };
	},
};

export async function loadConfigWithMigration(
	path: string,
	targetVersion: number,
): Promise<AnyVersionedConfig> {
	const raw = await readFile(path, "utf-8");
	const parsed = JSON.parse(raw);
	if (
		typeof parsed.schema_version !== "number" ||
		!Number.isInteger(parsed.schema_version) ||
		parsed.schema_version < 1
	) {
		throw new Error(
			`Config missing or invalid schema_version field (got: ${JSON.stringify(parsed.schema_version)})`,
		);
	}
	let cfg: AnyVersionedConfig = parsed;
	const original = cfg;

	while (cfg.schema_version < targetVersion) {
		const migrate = MIGRATIONS[cfg.schema_version];
		if (!migrate)
			throw new Error(
				`No migration from schema_version ${cfg.schema_version}`,
			);
		cfg = migrate(cfg);
	}

	if (cfg.schema_version > targetVersion) {
		throw new Error(
			`Config schema_version ${cfg.schema_version} is newer than supported (${targetVersion}). Update Apohara.`,
		);
	}

	if (cfg !== original) {
		await rename(path, path + ".bak");
		try {
			await atomicWriteJson(path, cfg);
		} catch (err) {
			// Restore .bak if write failed (closes non-atomic window)
			await rename(path + ".bak", path).catch(() => {});
			throw err;
		}
	}

	return cfg;
}
