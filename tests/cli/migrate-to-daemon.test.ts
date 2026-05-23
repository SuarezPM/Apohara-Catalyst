/**
 * G6.A.9 — migrate-to-daemon idempotency + detection tests.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { migrateToDaemon, resolveApoharaHome } from "../../src/cli/migrate-to-daemon";

let scratch: string;

beforeEach(async () => {
	scratch = await mkdtemp(path.join(tmpdir(), "apohara-migrate-"));
});

afterEach(async () => {
	await rm(scratch, { recursive: true, force: true });
});

test("no-legacy-state when no state.json exists", async () => {
	const result = await migrateToDaemon({ apoharaHome: scratch });
	expect(result.status).toBe("no-legacy-state");
	expect(result.profileCreated).toBe(true);
	expect(result.stateUpdated).toBe(false);
});

test("migrated when legacy state.json present without flag", async () => {
	const statePath = path.join(scratch, "state.json");
	await writeFile(statePath, JSON.stringify({ version: 1 }));
	const result = await migrateToDaemon({ apoharaHome: scratch });
	expect(result.status).toBe("migrated");
	expect(result.profileCreated).toBe(true);
	expect(result.stateUpdated).toBe(true);
	const after = JSON.parse(await readFile(statePath, "utf-8"));
	expect(after.daemon_mode_initialized).toBe(true);
	expect(after.migrated_at).toBeTruthy();
});

test("already-migrated when run twice", async () => {
	const statePath = path.join(scratch, "state.json");
	await writeFile(statePath, JSON.stringify({ version: 1 }));
	const first = await migrateToDaemon({ apoharaHome: scratch });
	expect(first.status).toBe("migrated");
	const second = await migrateToDaemon({ apoharaHome: scratch });
	expect(second.status).toBe("already-migrated");
	expect(second.profileCreated).toBe(false);
	expect(second.stateUpdated).toBe(false);
});

test("malformed legacy state.json is repaired in place", async () => {
	const statePath = path.join(scratch, "state.json");
	await writeFile(statePath, "{not-json");
	const result = await migrateToDaemon({ apoharaHome: scratch });
	expect(result.status).toBe("migrated");
	const after = JSON.parse(await readFile(statePath, "utf-8"));
	expect(after.daemon_mode_initialized).toBe(true);
});

test("profile is not overwritten if user already has one", async () => {
	const profilesDir = path.join(scratch, "profiles");
	await mkdir(profilesDir, { recursive: true });
	const profilePath = path.join(profilesDir, "default.json");
	await writeFile(
		profilePath,
		JSON.stringify({ name: "default", log_level: "trace" }),
	);
	const result = await migrateToDaemon({ apoharaHome: scratch });
	expect(result.profileCreated).toBe(false);
	const after = JSON.parse(await readFile(profilePath, "utf-8"));
	expect(after.log_level).toBe("trace");
});

test("resolveApoharaHome honors explicit override before APOHARA_HOME env", () => {
	const prev = process.env.APOHARA_HOME;
	process.env.APOHARA_HOME = "/from/env";
	try {
		expect(resolveApoharaHome({ apoharaHome: "/from/opts" })).toBe(
			"/from/opts",
		);
		expect(resolveApoharaHome()).toBe("/from/env");
	} finally {
		if (prev === undefined) {
			delete process.env.APOHARA_HOME;
		} else {
			process.env.APOHARA_HOME = prev;
		}
	}
});

test("custom profile name is written and detected", async () => {
	const result = await migrateToDaemon({
		apoharaHome: scratch,
		profileName: "staging",
	});
	expect(result.profileCreated).toBe(true);
	const profilePath = path.join(scratch, "profiles", "staging.json");
	const after = JSON.parse(await readFile(profilePath, "utf-8"));
	expect(after.name).toBe("staging");
});
