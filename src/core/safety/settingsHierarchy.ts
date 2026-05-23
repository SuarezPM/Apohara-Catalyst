/** 3-tier settings hierarchy per spec §4.6. */

import { readFile } from "node:fs/promises";
import {
	type AnyVersionedConfig,
	loadConfigWithMigration,
} from "../config/versioning.js";
import { atomicWriteJson } from "../persistence/atomicWrite.js";

export interface SettingsTier {
	source: "user_global" | "project_shared" | "project_local";
	patterns: string[];
	deny: string[];
}

/**
 * Versioned shape of `settings.json` on disk. Currently identical to the
 * config versioning chain target (v2). When new fields are added, bump the
 * versioning chain in `core/config/versioning.ts` and add a migration there;
 * `loadSettings` will pick them up automatically via `loadConfigWithMigration`.
 */
export type Settings = AnyVersionedConfig;

export interface MergedSettings {
	allow: string[];
	deny: string[];
}

export interface MergeOpts {
	/**
	 * Whether the user has explicitly trusted this project. When `false`
	 * (the default — safe for an unknown / freshly-cloned repo),
	 * `project_shared` and `project_local` patterns are IGNORED in the
	 * `allow` set: a hostile repo cannot escalate permissions just by
	 * shipping its own `.claude/settings.json`. All tiers still
	 * contribute to `deny` (any tier can lock something down).
	 *
	 * Callers wire this from the runtime trust check (e.g. presence of
	 * the workspace path in `~/.apohara/trusted-projects`).
	 */
	trustProject?: boolean;
}

export function mergeSettingsTiers(
	tiers: SettingsTier[],
	opts: MergeOpts = {},
): MergedSettings {
	const trustProject = opts.trustProject ?? false;
	const allow = new Set<string>();
	const deny = new Set<string>();
	for (const t of tiers) {
		const contributesAllow = t.source === "user_global" || trustProject;
		if (contributesAllow) {
			for (const p of t.patterns) allow.add(p);
		}
		for (const p of t.deny) deny.add(p);
	}
	return { allow: Array.from(allow), deny: Array.from(deny) };
}

/**
 * Load and migrate `settings.json` from disk.
 *
 * Multica #17 fix (T4.4c): cables the generic versioning chain
 * (`loadConfigWithMigration`, T4.8b) into the settings loader so adding
 * a new field in a release does NOT break existing installs.
 *
 * Behavior:
 *   - Legacy file (no `schema_version`) is auto-promoted to v1 in-place,
 *     then migrated v1 → v2 by the versioning chain.
 *   - Already-versioned file is passed through (and migrated forward if
 *     `schema_version` is older than the chain target).
 *   - A `.bak` snapshot of the pre-migration form is written by
 *     `loadConfigWithMigration` whenever a migration step runs (it also
 *     restores `.bak` on write failure).
 */
export async function loadAndMigrateSettings(path: string): Promise<Settings> {
	const raw = JSON.parse(await readFile(path, "utf-8"));
	// Auto-promote legacy (no schema_version) to v1 so the generic
	// migration chain can take over from a known baseline.
	if (raw.schema_version === undefined) {
		raw.schema_version = 1;
		await atomicWriteJson(path, raw);
	}
	const migrated = await loadConfigWithMigration(path, /*targetVersion=*/ 2);
	return migrated;
}
