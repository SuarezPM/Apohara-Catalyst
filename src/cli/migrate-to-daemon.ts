/**
 * `apohara migrate-to-daemon` — one-shot migration helper (G6.A.9).
 *
 * Detects whether the current install is a pre-Sprint-6 single-process
 * deployment and prepares it for daemon mode. Idempotent: re-running on an
 * already-migrated install reports `already-migrated` and exits 0.
 *
 * Detection signals:
 * - Presence of legacy single-process state file (`~/.apohara/state.json`
 *   without a `daemon_mode_initialized` flag).
 * - Absence of any profile at `~/.apohara/profiles/default.json`.
 *
 * Migration steps (each individually idempotent):
 * 1. Create profiles directory.
 * 2. Write a default profile (`default.json`) if missing.
 * 3. Stamp `daemon_mode_initialized: true` on the legacy state file (so a
 *    subsequent run sees the migration is done).
 *
 * The command does NOT flip `APOHARA_DAEMON_MODE` itself — that opt-in stays
 * a user decision. It only seeds the artifacts the daemon will need on
 * first start.
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface MigrateResult {
	status: "already-migrated" | "migrated" | "no-legacy-state";
	profileCreated: boolean;
	stateUpdated: boolean;
	apoharaHome: string;
}

export interface MigrateOptions {
	/** Override the user home for tests / portable installs. */
	apoharaHome?: string;
	/** Profile name to seed. Defaults to "default". */
	profileName?: string;
}

export function resolveApoharaHome(opts: MigrateOptions = {}): string {
	if (opts.apoharaHome) return opts.apoharaHome;
	if (process.env.APOHARA_HOME && process.env.APOHARA_HOME.length > 0) {
		return process.env.APOHARA_HOME;
	}
	return path.join(os.homedir(), ".apohara");
}

async function pathExists(p: string): Promise<boolean> {
	try {
		await fs.access(p);
		return true;
	} catch {
		return false;
	}
}

export async function migrateToDaemon(
	opts: MigrateOptions = {},
): Promise<MigrateResult> {
	const home = resolveApoharaHome(opts);
	const profileName = opts.profileName ?? "default";
	const profilesDir = path.join(home, "profiles");
	const profilePath = path.join(profilesDir, `${profileName}.json`);
	const statePath = path.join(home, "state.json");

	await fs.mkdir(profilesDir, { recursive: true });

	let profileCreated = false;
	if (!(await pathExists(profilePath))) {
		const defaultBody = {
			name: profileName,
			log_level: "info",
		};
		await fs.writeFile(
			profilePath,
			`${JSON.stringify(defaultBody, null, 2)}\n`,
			"utf-8",
		);
		profileCreated = true;
	}

	let stateUpdated = false;
	let legacyDetected = false;
	if (await pathExists(statePath)) {
		legacyDetected = true;
		let parsed: any = {};
		try {
			parsed = JSON.parse(await fs.readFile(statePath, "utf-8"));
		} catch {
			parsed = {};
		}
		if (!parsed || typeof parsed !== "object") parsed = {};
		if (parsed.daemon_mode_initialized !== true) {
			parsed.daemon_mode_initialized = true;
			parsed.migrated_at = new Date().toISOString();
			await fs.writeFile(
				statePath,
				`${JSON.stringify(parsed, null, 2)}\n`,
				"utf-8",
			);
			stateUpdated = true;
		}
	}

	let status: MigrateResult["status"];
	if (!legacyDetected) {
		status = "no-legacy-state";
	} else if (!profileCreated && !stateUpdated) {
		status = "already-migrated";
	} else {
		status = "migrated";
	}

	return {
		status,
		profileCreated,
		stateUpdated,
		apoharaHome: home,
	};
}
