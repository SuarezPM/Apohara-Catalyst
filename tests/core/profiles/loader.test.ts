/**
 * G6.A.8 — profile loader tests (TS counterpart of the Rust crate). Verifies
 * the wire format matches the Rust side so both runtimes resolve to the same
 * socket path / HTTP poll port for a given profile name.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
	defaultProfile,
	effectiveHttpPollPort,
	extractProfileArg,
	loadProfile,
	loadProfileFromPath,
	ProfileError,
	profilesRoot,
	socketPathFor,
	validateProfileName,
} from "../../../src/core/profiles/loader";

let originalApoharaHome: string | undefined;
let scratch: string;

beforeEach(async () => {
	originalApoharaHome = process.env.APOHARA_HOME;
	scratch = await mkdtemp(path.join(tmpdir(), "apohara-profiles-"));
	process.env.APOHARA_HOME = scratch;
	await mkdir(path.join(scratch, "profiles"), { recursive: true });
});

afterEach(async () => {
	if (originalApoharaHome === undefined) {
		delete process.env.APOHARA_HOME;
	} else {
		process.env.APOHARA_HOME = originalApoharaHome;
	}
	await rm(scratch, { recursive: true, force: true });
});

test("defaultProfile returns the canonical default", () => {
	const p = defaultProfile();
	expect(p.name).toBe("default");
	expect(p.logLevel).toBe("info");
});

test("validateProfileName accepts alnum, dash, underscore", () => {
	expect(() => validateProfileName("dev")).not.toThrow();
	expect(() => validateProfileName("staging-eu")).not.toThrow();
	expect(() => validateProfileName("prod_2")).not.toThrow();
});

test("validateProfileName rejects traversal and whitespace", () => {
	expect(() => validateProfileName("../etc/passwd")).toThrow(ProfileError);
	expect(() => validateProfileName("with space")).toThrow(ProfileError);
	expect(() => validateProfileName("")).toThrow(ProfileError);
	expect(() => validateProfileName("a".repeat(65))).toThrow(ProfileError);
});

test("profilesRoot honors APOHARA_HOME", () => {
	expect(profilesRoot()).toBe(path.join(scratch, "profiles"));
});

test("loadProfile reads JSON and forces filename as name", async () => {
	const file = path.join(scratch, "profiles", "staging.json");
	await writeFile(
		file,
		JSON.stringify({
			name: "lies-do-not-matter",
			socket_path_override: "/var/run/apohara-staging.sock",
			http_poll_port: 12345,
			log_level: "debug",
		}),
	);
	const p = await loadProfile("staging");
	expect(p.name).toBe("staging");
	expect(p.socketPathOverride).toBe("/var/run/apohara-staging.sock");
	expect(p.httpPollPort).toBe(12345);
	expect(p.logLevel).toBe("debug");
});

test("loadProfile NOT_FOUND when file missing", async () => {
	let caught: unknown;
	try {
		await loadProfile("missing");
	} catch (e) {
		caught = e;
	}
	expect(caught).toBeInstanceOf(ProfileError);
	expect((caught as ProfileError).code).toBe("NOT_FOUND");
});

test("loadProfile PARSE_ERROR on malformed JSON", async () => {
	const file = path.join(scratch, "profiles", "broken.json");
	await writeFile(file, "{not json");
	let caught: unknown;
	try {
		await loadProfile("broken");
	} catch (e) {
		caught = e;
	}
	expect((caught as ProfileError).code).toBe("PARSE_ERROR");
});

test("socketPathFor honors override and differs per profile name", () => {
	const a = { name: "dev", logLevel: "info" };
	const b = { name: "staging", logLevel: "info" };
	const o = {
		name: "x",
		logLevel: "info",
		socketPathOverride: "/tmp/custom.sock",
	};
	expect(socketPathFor(o)).toBe("/tmp/custom.sock");
	expect(socketPathFor(a)).not.toBe(socketPathFor(b));
	expect(socketPathFor(a)).toMatch(/apohara-dev\.sock$/);
});

test("effectiveHttpPollPort deterministic per name, distinct across names", () => {
	const dev = { name: "dev", logLevel: "info" };
	const prod = { name: "prod", logLevel: "info" };
	const portDev1 = effectiveHttpPollPort(dev);
	const portDev2 = effectiveHttpPollPort(dev);
	expect(portDev1).toBe(portDev2);
	expect(portDev1).toBeGreaterThanOrEqual(49152);
	expect(portDev1).toBeLessThanOrEqual(65535);
	expect(effectiveHttpPollPort(dev)).not.toBe(effectiveHttpPollPort(prod));
});

test("effectiveHttpPollPort explicit wins", () => {
	expect(
		effectiveHttpPollPort({ name: "x", logLevel: "info", httpPollPort: 31337 }),
	).toBe(31337);
});

test("extractProfileArg parses both --profile=NAME and --profile NAME", () => {
	expect(extractProfileArg(["--profile=staging"])).toBe("staging");
	expect(extractProfileArg(["x", "--profile", "prod", "y"])).toBe("prod");
	expect(extractProfileArg(["--other"])).toBeUndefined();
	expect(extractProfileArg([])).toBeUndefined();
});

test("loadProfileFromPath surfaces NOT_FOUND for missing", async () => {
	let caught: unknown;
	try {
		await loadProfileFromPath("/nope/missing.json", "missing");
	} catch (e) {
		caught = e;
	}
	expect((caught as ProfileError).code).toBe("NOT_FOUND");
});
