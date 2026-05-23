/**
 * Per-worktree env isolation — G5.C.4 (claude-octopus #10).
 *
 * Each worktree directory may carry a `.env` file with worktree-local
 * APOHARA_* overrides (log level, feature flags, dispatcher tuning).
 * When the orchestrator spawns a subagent for a worktree it composes the
 * final env as:
 *
 *   1. Base sanitized env (no API keys — §0.4)
 *   2. Worktree-local overrides from `<worktree>/.env`
 *   3. Forced markers: APOHARA_WORKTREE_ID, APOHARA_WORKTREE_PATH
 *      (set LAST so a malicious .env can't spoof them)
 *
 * The reader rejects any key matching the credential blocklist used by
 * `envSanitizer` so a worktree .env cannot smuggle ANTHROPIC_API_KEY or
 * GITHUB_TOKEN past the orchestrator. We also reject path-prefixed keys
 * (PATH, HOME) when `strict: true` to lock the worktree down to APOHARA_
 * variables only — the spawn path provides PATH/HOME through the base env.
 *
 * Cross-ref: spec §0.4 (env sanitization), §3.6 (worktree lifecycle).
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_BLOCKLIST } from "../persistence/envSanitizer.js";

export interface LoadOptions {
	strict?: boolean;
}

export interface ComposeOptions {
	baseEnv: Record<string, string>;
	worktreePath: string;
	worktreeId: string;
	loadOptions?: LoadOptions;
}

const KEY_VALUE_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

function stripQuotes(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length < 2) return trimmed;
	const first = trimmed[0];
	const last = trimmed[trimmed.length - 1];
	if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

function isBlocklistedKey(key: string): boolean {
	for (const re of DEFAULT_BLOCKLIST) {
		if (re.test(key)) return true;
	}
	return false;
}

function isForcedMarker(key: string): boolean {
	return key === "APOHARA_WORKTREE_ID" || key === "APOHARA_WORKTREE_PATH";
}

export async function loadWorktreeEnv(
	worktreePath: string,
	opts: LoadOptions = {},
): Promise<Record<string, string>> {
	const file = join(worktreePath, ".env");
	let raw: string;
	try {
		raw = await readFile(file, "utf-8");
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw err;
	}

	const out: Record<string, string> = {};
	for (const lineRaw of raw.split(/\r?\n/)) {
		const line = lineRaw.trim();
		if (line === "" || line.startsWith("#")) continue;
		const match = KEY_VALUE_LINE.exec(lineRaw);
		if (!match) continue;
		const key = match[1];
		const value = stripQuotes(match[2]);

		// Credentials NEVER pass through worktree .env (§0.4 hard rule).
		if (isBlocklistedKey(key)) continue;

		// Forced markers NEVER come from .env — composeWorktreeEnv sets them.
		if (isForcedMarker(key)) continue;

		// Strict mode: APOHARA_* only.
		if (opts.strict && !key.startsWith("APOHARA_")) continue;

		out[key] = value;
	}
	return out;
}

export async function composeWorktreeEnv(
	opts: ComposeOptions,
): Promise<Record<string, string>> {
	const local = await loadWorktreeEnv(opts.worktreePath, opts.loadOptions);
	const merged: Record<string, string> = { ...opts.baseEnv, ...local };
	// Forced markers go last so a malicious .env can't spoof identity.
	merged.APOHARA_WORKTREE_ID = opts.worktreeId;
	merged.APOHARA_WORKTREE_PATH = opts.worktreePath;
	return merged;
}
