/**
 * G6.A.10 — backward-compat shim tests.
 *
 * Verifies both execution paths:
 *  1. monolithic when APOHARA_DAEMON_MODE is unset
 *  2. monolithic when flag is set but daemon socket is unreachable
 *  3. daemon-attached when flag is set AND probe returns reachable
 *  4. profile argument is honored regardless of mode
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
	defaultSocketProbe,
	describeEntryDecision,
	resolveEntryMode,
} from "../../src/cli/entry";

let scratch: string;
let originalEnv: Record<string, string | undefined> = {};

beforeEach(async () => {
	scratch = await mkdtemp(path.join(tmpdir(), "apohara-entry-"));
	originalEnv = {
		APOHARA_DAEMON_MODE: process.env.APOHARA_DAEMON_MODE,
		APOHARA_HOME: process.env.APOHARA_HOME,
	};
	process.env.APOHARA_HOME = scratch;
});

afterEach(async () => {
	for (const [k, v] of Object.entries(originalEnv)) {
		if (v === undefined) {
			delete process.env[k];
		} else {
			process.env[k] = v;
		}
	}
	await rm(scratch, { recursive: true, force: true });
});

test("monolithic when daemon flag is off", async () => {
	delete process.env.APOHARA_DAEMON_MODE;
	const d = await resolveEntryMode({
		argv: [],
		probeSocket: async () => true, // even if reachable, flag is off
	});
	expect(d.mode).toBe("monolithic");
	expect(d.reason).toBe("daemon-flag-off");
	expect(d.profile.name).toBe("default");
});

test("monolithic when flag is on but socket unreachable", async () => {
	process.env.APOHARA_DAEMON_MODE = "1";
	const d = await resolveEntryMode({
		argv: [],
		probeSocket: async () => false,
	});
	expect(d.mode).toBe("monolithic");
	expect(d.reason).toBe("daemon-socket-unreachable");
});

test("daemon-attached when flag on and socket reachable", async () => {
	process.env.APOHARA_DAEMON_MODE = "1";
	const d = await resolveEntryMode({
		argv: [],
		probeSocket: async () => true,
	});
	expect(d.mode).toBe("daemon");
	expect(d.reason).toBe("daemon-attached");
});

test("profile arg is honored regardless of mode", async () => {
	const profilesDir = path.join(scratch, "profiles");
	await mkdir(profilesDir, { recursive: true });
	await writeFile(
		path.join(profilesDir, "staging.json"),
		JSON.stringify({ log_level: "debug" }),
	);
	const d = await resolveEntryMode({
		argv: ["--profile=staging"],
		probeSocket: async () => false,
	});
	expect(d.profile.name).toBe("staging");
	expect(d.profile.logLevel).toBe("debug");
});

test("missing profile file falls back to defaults under that name", async () => {
	const d = await resolveEntryMode({
		argv: ["--profile", "ghost"],
		probeSocket: async () => false,
	});
	expect(d.profile.name).toBe("ghost");
	expect(d.profile.logLevel).toBe("info");
});

test("forcedMode short-circuits", async () => {
	const d = await resolveEntryMode({
		argv: [],
		forcedMode: "daemon",
	});
	expect(d.mode).toBe("daemon");
	expect(d.reason).toBe("test-injected");
});

test("describeEntryDecision renders a single line banner", async () => {
	const d = await resolveEntryMode({
		argv: [],
		probeSocket: async () => false,
	});
	const line = describeEntryDecision(d);
	expect(line).toContain("mode=monolithic");
	expect(line).toContain("profile=default");
	expect(line).toContain("socket=");
});

test("defaultSocketProbe returns false for missing path", async () => {
	const reachable = await defaultSocketProbe(
		path.join(scratch, "no-such-socket"),
	);
	expect(reachable).toBe(false);
});

test("env override is read from opts.env if provided", async () => {
	const d = await resolveEntryMode({
		argv: [],
		env: { APOHARA_DAEMON_MODE: "1", APOHARA_HOME: scratch },
		probeSocket: async () => true,
	});
	expect(d.mode).toBe("daemon");
});
