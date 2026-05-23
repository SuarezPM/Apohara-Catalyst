/**
 * `apohara` CLI entry shim (G6.A.10).
 *
 * Decides between two execution modes at startup:
 *
 *  - **Daemon mode** (`APOHARA_DAEMON_MODE=1` AND daemon socket reachable):
 *    spawn / attach to the daemon, route every command through the client.
 *
 *  - **Monolithic mode** (default, OR daemon not reachable even when env
 *    flag is on): boot the in-process embedded server like Apohara v1.0
 *    did. Backward-compat: every existing installation keeps working.
 *
 * The shim is the single source of truth for the decision so individual
 * commands don't sniff env flags ad-hoc. Each mode is selected once per
 * process via `resolveEntryMode()`.
 */
import { promises as fs } from "node:fs";

import {
	defaultProfile,
	extractProfileArg,
	loadProfile,
	type Profile,
	socketPathFor,
} from "../core/profiles/loader";

export type EntryMode = "daemon" | "monolithic";

export interface EntryDecision {
	mode: EntryMode;
	profile: Profile;
	/** Why we landed here — useful in logs and the doctor command. */
	reason:
		| "daemon-flag-off"
		| "daemon-socket-unreachable"
		| "daemon-attached"
		| "explicit-monolithic"
		| "test-injected";
	socketPath: string;
}

export interface ResolveEntryModeOptions {
	argv?: readonly string[];
	env?: NodeJS.ProcessEnv;
	/** Test seam — accept a function that probes whether the socket exists. */
	probeSocket?: (socketPath: string) => Promise<boolean>;
	/** Force a specific mode (for tests). */
	forcedMode?: EntryMode;
}

/**
 * Default socket-reachability probe. A socket is considered reachable when
 * the path exists AND looks like a socket (`mode & 0o140000`). The exact
 * connection happens later in the client crate — this is the lightweight
 * "is there a live daemon?" check.
 */
export async function defaultSocketProbe(socketPath: string): Promise<boolean> {
	try {
		const st = await fs.stat(socketPath);
		// On POSIX, sockets have S_IFSOCK (0o140000). On Windows the path is a
		// named pipe under \\.\pipe\... which won't fs.stat, so we'd never get
		// here — those installs always go through the daemon socket adapter.
		// We fall back to "exists" if mode bits are unset.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const mode: number = (st as any).mode ?? 0;
		if (mode === 0) return true;
		const ifsock = 0o140000;
		return (mode & 0o170000) === ifsock;
	} catch {
		return false;
	}
}

export async function resolveEntryMode(
	opts: ResolveEntryModeOptions = {},
): Promise<EntryDecision> {
	const argv = opts.argv ?? process.argv.slice(2);
	const env = opts.env ?? process.env;
	const probe = opts.probeSocket ?? defaultSocketProbe;

	const profileName = extractProfileArg(argv);
	let profile: Profile;
	if (profileName) {
		try {
			profile = await loadProfile(profileName);
		} catch {
			profile = { ...defaultProfile(), name: profileName };
		}
	} else {
		profile = defaultProfile();
	}
	const socketPath = socketPathFor(profile);

	if (opts.forcedMode) {
		return {
			mode: opts.forcedMode,
			profile,
			reason: "test-injected",
			socketPath,
		};
	}

	const daemonModeFlag = env.APOHARA_DAEMON_MODE === "1";
	if (!daemonModeFlag) {
		return {
			mode: "monolithic",
			profile,
			reason: "daemon-flag-off",
			socketPath,
		};
	}

	const reachable = await probe(socketPath);
	if (!reachable) {
		return {
			mode: "monolithic",
			profile,
			reason: "daemon-socket-unreachable",
			socketPath,
		};
	}

	return {
		mode: "daemon",
		profile,
		reason: "daemon-attached",
		socketPath,
	};
}

/**
 * Format the decision as a single human-readable banner. Used by the
 * `apohara doctor` command and by startup logs.
 */
export function describeEntryDecision(d: EntryDecision): string {
	return [
		`mode=${d.mode}`,
		`profile=${d.profile.name}`,
		`reason=${d.reason}`,
		`socket=${d.socketPath}`,
	].join(" ");
}
