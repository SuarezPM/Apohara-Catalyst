/**
 * Profile loader (G6.A.8) — TS counterpart of
 * `crates/apohara-daemon/src/profiles.rs`.
 *
 * Daemon profiles live in `~/.apohara/profiles/<name>.json`. The CLI reads a
 * profile when `apohara --profile=<name>` is passed and forwards the
 * resolved socket path / port to the daemon (or to the embedded monolithic
 * server if daemon mode is OFF).
 *
 * Implementation invariants:
 * - Profile names must be alphanumeric + dash + underscore (no traversal).
 * - The on-disk `name` field is ignored — the filename is canonical.
 * - `APOHARA_HOME` overrides the profiles root for tests / portable installs.
 * - Default profile is implicit; callers can ask for it without a file.
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface Profile {
	name: string;
	socketPathOverride?: string;
	httpPollPort?: number;
	logLevel: string;
}

export class ProfileError extends Error {
	constructor(
		message: string,
		public readonly code:
			| "INVALID_NAME"
			| "NOT_FOUND"
			| "PARSE_ERROR"
			| "IO_ERROR",
	) {
		super(message);
		this.name = "ProfileError";
	}
}

const NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function validateProfileName(name: string): void {
	if (!NAME_RE.test(name)) {
		throw new ProfileError(
			`profile name must match ${NAME_RE} (got ${JSON.stringify(name)})`,
			"INVALID_NAME",
		);
	}
}

export function defaultProfile(): Profile {
	return {
		name: "default",
		logLevel: "info",
	};
}

export function profilesRoot(): string {
	const override = process.env.APOHARA_HOME;
	if (override && override.length > 0) {
		return path.join(override, "profiles");
	}
	return path.join(os.homedir(), ".apohara", "profiles");
}

export async function loadProfile(name: string): Promise<Profile> {
	validateProfileName(name);
	const file = path.join(profilesRoot(), `${name}.json`);
	return loadProfileFromPath(file, name);
}

export async function loadProfileFromPath(
	file: string,
	expectedName: string,
): Promise<Profile> {
	validateProfileName(expectedName);
	let raw: string;
	try {
		raw = await fs.readFile(file, "utf-8");
	} catch (err: any) {
		if (err?.code === "ENOENT") {
			throw new ProfileError(
				`profile not found at ${file}`,
				"NOT_FOUND",
			);
		}
		throw new ProfileError(
			`failed to read profile at ${file}: ${err?.message ?? String(err)}`,
			"IO_ERROR",
		);
	}
	let parsed: any;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		throw new ProfileError(
			`profile JSON parse error at ${file}: ${(err as Error).message}`,
			"PARSE_ERROR",
		);
	}
	const profile: Profile = {
		name: expectedName,
		socketPathOverride:
			typeof parsed.socket_path_override === "string"
				? parsed.socket_path_override
				: typeof parsed.socketPathOverride === "string"
					? parsed.socketPathOverride
					: undefined,
		httpPollPort:
			typeof parsed.http_poll_port === "number"
				? parsed.http_poll_port
				: typeof parsed.httpPollPort === "number"
					? parsed.httpPollPort
					: undefined,
		logLevel:
			typeof parsed.log_level === "string"
				? parsed.log_level
				: typeof parsed.logLevel === "string"
					? parsed.logLevel
					: "info",
	};
	return profile;
}

/**
 * Returns the socket path for a profile. Mirrors the Rust hash-of-name fall-
 * back so a TS-launched client and the Rust daemon agree without explicit
 * coordination.
 */
export function socketPathFor(profile: Profile): string {
	if (profile.socketPathOverride) return profile.socketPathOverride;
	const base =
		process.env.XDG_RUNTIME_DIR && process.env.XDG_RUNTIME_DIR.length > 0
			? process.env.XDG_RUNTIME_DIR
			: os.tmpdir();
	return path.join(base, `apohara-${profile.name}.sock`);
}

/**
 * Same FNV-1a hash used in the Rust crate so a TS client can compute the
 * port without consulting the daemon.
 */
export function effectiveHttpPollPort(profile: Profile): number {
	if (profile.httpPollPort != null) return profile.httpPollPort;
	let hash = 2166136261 >>> 0;
	for (let i = 0; i < profile.name.length; i++) {
		hash = Math.imul(hash, 16777619) >>> 0;
		hash = (hash ^ profile.name.charCodeAt(i)) >>> 0;
	}
	const span = 65535 - 49152 + 1;
	return 49152 + (hash % span);
}

/**
 * Extract a `--profile=<name>` / `--profile <name>` argument from argv. Returns
 * undefined when not present. Argv is not mutated.
 */
export function extractProfileArg(argv: readonly string[]): string | undefined {
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a.startsWith("--profile=")) {
			return a.slice("--profile=".length);
		}
		if (a === "--profile" && i + 1 < argv.length) {
			return argv[i + 1];
		}
	}
	return undefined;
}
