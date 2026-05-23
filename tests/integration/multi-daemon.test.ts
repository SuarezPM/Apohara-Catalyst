/**
 * G6.A.12 — multi-daemon coexistence integration test.
 *
 * Three concurrent profiles (dev/staging/prod) must:
 *  1. Resolve to three different socket paths.
 *  2. Resolve to three different HTTP poll ports.
 *  3. Be loadable from disk in parallel without state bleed between them.
 *  4. Survive a re-migration without overwriting each other's config.
 *
 * The Rust daemon binary is exercised by `cargo test -p apohara-daemon`;
 * this test focuses on the TS plumbing that selects a profile and resolves
 * its endpoints so the CLI can talk to the correct daemon instance.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
	effectiveHttpPollPort,
	loadProfile,
	socketPathFor,
} from "../../src/core/profiles/loader";
import { resolveEntryMode } from "../../src/cli/entry";
import { migrateToDaemon } from "../../src/cli/migrate-to-daemon";

let scratch: string;
let originalEnv: Record<string, string | undefined>;

beforeEach(async () => {
	scratch = await mkdtemp(path.join(tmpdir(), "apohara-multi-daemon-"));
	originalEnv = {
		APOHARA_HOME: process.env.APOHARA_HOME,
		APOHARA_DAEMON_MODE: process.env.APOHARA_DAEMON_MODE,
	};
	process.env.APOHARA_HOME = scratch;
	const profilesDir = path.join(scratch, "profiles");
	await mkdir(profilesDir, { recursive: true });
	for (const name of ["dev", "staging", "prod"]) {
		await writeFile(
			path.join(profilesDir, `${name}.json`),
			JSON.stringify({ log_level: name === "prod" ? "warn" : "info" }),
		);
	}
});

afterEach(async () => {
	for (const [k, v] of Object.entries(originalEnv)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
	await rm(scratch, { recursive: true, force: true });
});

test("three profiles resolve to three distinct socket paths", async () => {
	const [dev, staging, prod] = await Promise.all([
		loadProfile("dev"),
		loadProfile("staging"),
		loadProfile("prod"),
	]);
	const sockets = [
		socketPathFor(dev),
		socketPathFor(staging),
		socketPathFor(prod),
	];
	expect(new Set(sockets).size).toBe(3);
	for (const s of sockets) {
		expect(s).toMatch(/apohara-[a-z]+\.sock$/);
	}
});

test("three profiles resolve to three distinct HTTP poll ports", async () => {
	const [dev, staging, prod] = await Promise.all([
		loadProfile("dev"),
		loadProfile("staging"),
		loadProfile("prod"),
	]);
	const ports = [
		effectiveHttpPollPort(dev),
		effectiveHttpPollPort(staging),
		effectiveHttpPollPort(prod),
	];
	expect(new Set(ports).size).toBe(3);
	for (const p of ports) {
		expect(p).toBeGreaterThanOrEqual(49152);
		expect(p).toBeLessThanOrEqual(65535);
	}
});

test("concurrent profile loads are isolated", async () => {
	const results = await Promise.all([
		loadProfile("dev"),
		loadProfile("staging"),
		loadProfile("prod"),
		loadProfile("dev"),
		loadProfile("staging"),
		loadProfile("prod"),
	]);
	expect(results[0].name).toBe("dev");
	expect(results[0].logLevel).toBe("info");
	expect(results[2].name).toBe("prod");
	expect(results[2].logLevel).toBe("warn");
	expect(results[3].name).toBe("dev");
	expect(results[4].logLevel).toBe("info");
});

test("entry shim selects correct socket per profile", async () => {
	const dDev = await resolveEntryMode({
		argv: ["--profile=dev"],
		env: { APOHARA_DAEMON_MODE: "1", APOHARA_HOME: scratch },
		probeSocket: async () => false, // force monolithic so we just check socket path
	});
	const dProd = await resolveEntryMode({
		argv: ["--profile=prod"],
		env: { APOHARA_DAEMON_MODE: "1", APOHARA_HOME: scratch },
		probeSocket: async () => false,
	});
	expect(dDev.profile.name).toBe("dev");
	expect(dProd.profile.name).toBe("prod");
	expect(dDev.socketPath).not.toBe(dProd.socketPath);
});

test("re-migrating does not clobber existing daemon profiles", async () => {
	// Pretend a legacy install with three already-migrated profiles. Migration
	// should be a no-op for each (already-migrated or no-legacy-state).
	const r1 = await migrateToDaemon({
		apoharaHome: scratch,
		profileName: "dev",
	});
	const r2 = await migrateToDaemon({
		apoharaHome: scratch,
		profileName: "staging",
	});
	const r3 = await migrateToDaemon({
		apoharaHome: scratch,
		profileName: "prod",
	});
	for (const r of [r1, r2, r3]) {
		expect(r.profileCreated).toBe(false);
	}
	// And the existing profile bodies remain intact.
	const dev = await loadProfile("dev");
	const prod = await loadProfile("prod");
	expect(dev.logLevel).toBe("info");
	expect(prod.logLevel).toBe("warn");
});
