/**
 * gh CLI wrapper — single entry point so every GitHub interaction
 * (PRs, Issues, Actions, etc.) flows through one rate-limit guard.
 * Lifted from orca's `src/main/github/client.ts:1-80+` with the
 * Electron-specific bits removed.
 *
 * Why a single wrapper:
 *   - `gh` shares quota with the user's other tooling (gh dash,
 *     editor integrations, CI). Hammering it from a multi-agent
 *     orchestrator is the fastest way to get the user rate-limited
 *     for the day.
 *   - One module makes the per-request retry / cooldown policy
 *     editable in one place.
 *   - The CLI's stdout shape is sometimes JSON, sometimes plain
 *     text; centralising the parse logic keeps callers honest.
 *
 * The wrapper:
 *   - Throttles to N calls per rolling 60 s window
 *     (`APOHARA_GH_RATE_LIMIT_PER_MIN`, default 30).
 *   - Detects "API rate limit exceeded" responses and sets a
 *     cooldown until the reported reset.
 *   - Refuses to spawn `gh` if it's not on PATH (returns a clear
 *     error rather than silent failure).
 *   - Inherits the user's gh auth (we DON'T pass credentials).
 *     env stays sanitized via §0.4.
 */
import { spawn } from "node:child_process";
import { sanitizeEnv } from "../persistence/envSanitizer.js";

const DEFAULT_RATE_LIMIT_PER_MIN = Number(
	process.env.APOHARA_GH_RATE_LIMIT_PER_MIN ?? "30",
);
const RATE_WINDOW_MS = 60_000;

const callTimestamps: number[] = [];
let cooldownUntilMs = 0;

function nowMs(): number {
	return Date.now();
}

function pruneOldTimestamps(): void {
	const cutoff = nowMs() - RATE_WINDOW_MS;
	while (callTimestamps.length > 0 && callTimestamps[0] < cutoff) {
		callTimestamps.shift();
	}
}

function recordCall(): void {
	callTimestamps.push(nowMs());
}

async function waitForRateSlot(): Promise<void> {
	while (true) {
		if (cooldownUntilMs > nowMs()) {
			const wait = cooldownUntilMs - nowMs();
			await new Promise((r) => setTimeout(r, Math.min(wait, 5_000)));
			continue;
		}
		pruneOldTimestamps();
		if (callTimestamps.length < DEFAULT_RATE_LIMIT_PER_MIN) return;
		const wait = RATE_WINDOW_MS - (nowMs() - callTimestamps[0]) + 100;
		await new Promise((r) => setTimeout(r, Math.max(wait, 100)));
	}
}

export interface GhResult {
	ok: boolean;
	stdout: string;
	stderr: string;
	code: number;
}

export async function gh(args: string[]): Promise<GhResult> {
	await waitForRateSlot();
	recordCall();

	const env = sanitizeEnv(process.env as Record<string, string | undefined>, {
		// gh reads its own auth from `~/.config/gh/` — don't override.
		allow: ["GH_TOKEN_ALLOWED_NEVER"], // empty allowlist (gh uses its config file)
	});
	env.GIT_PAGER = "cat";
	env.PAGER = "cat";

	return new Promise<GhResult>((resolve) => {
		const child = spawn("gh", args, {
			env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout?.on("data", (c) => (stdout += c.toString("utf-8")));
		child.stderr?.on("data", (c) => (stderr += c.toString("utf-8")));
		child.on("error", (err) => {
			const e = err as NodeJS.ErrnoException;
			if (e.code === "ENOENT") {
				resolve({
					ok: false,
					stdout: "",
					stderr:
						"gh CLI not found on PATH. Install from https://cli.github.com/ to enable GitHub integration.",
					code: -1,
				});
			} else {
				resolve({ ok: false, stdout, stderr: err.message, code: -1 });
			}
		});
		child.on("close", (code) => {
			const exitCode = code ?? -1;
			// gh emits "API rate limit exceeded" on 4xx-rate-limited
			// calls. When we see that, push our cooldown out to the
			// reset window the API reports (best-effort regex).
			if (
				exitCode !== 0 &&
				/rate limit/i.test(stderr) &&
				stderr.match(/X-RateLimit-Reset:\s*(\d+)/i)
			) {
				const reset = Number.parseInt(
					stderr.match(/X-RateLimit-Reset:\s*(\d+)/i)![1],
					10,
				);
				cooldownUntilMs = reset * 1000 + 1_000;
			}
			resolve({ ok: exitCode === 0, stdout, stderr, code: exitCode });
		});
	});
}

/** Convenience: run `gh` and JSON-parse stdout. Returns `null` on any
 * failure path (non-zero exit, invalid JSON). */
export async function ghJson<T = unknown>(args: string[]): Promise<T | null> {
	const r = await gh(args);
	if (!r.ok) return null;
	try {
		return JSON.parse(r.stdout) as T;
	} catch {
		return null;
	}
}

// --- High-level helpers ---

export interface IssueSummary {
	number: number;
	title: string;
	state: string;
	url: string;
	body?: string;
	labels?: { name: string }[];
	author?: { login: string };
}

export async function listIssues(opts: {
	state?: "open" | "closed" | "all";
	limit?: number;
} = {}): Promise<IssueSummary[]> {
	const args = [
		"issue",
		"list",
		"--state",
		opts.state ?? "open",
		"--json",
		"number,title,state,url,body,labels,author",
		"--limit",
		String(opts.limit ?? 30),
	];
	return (await ghJson<IssueSummary[]>(args)) ?? [];
}

export async function getIssue(
	number: number,
): Promise<IssueSummary | null> {
	return ghJson<IssueSummary>([
		"issue",
		"view",
		String(number),
		"--json",
		"number,title,state,url,body,labels,author",
	]);
}

export async function addIssueComment(
	number: number,
	body: string,
): Promise<boolean> {
	const r = await gh(["issue", "comment", String(number), "--body", body]);
	return r.ok;
}

export interface PrSummary {
	number: number;
	title: string;
	state: string;
	url: string;
	mergeable: string | null;
	headRefName: string;
	baseRefName: string;
}

export async function listPRs(opts: { state?: "open" | "closed" | "merged" | "all"; limit?: number } = {}): Promise<PrSummary[]> {
	const args = [
		"pr",
		"list",
		"--state",
		opts.state ?? "open",
		"--json",
		"number,title,state,url,mergeable,headRefName,baseRefName",
		"--limit",
		String(opts.limit ?? 30),
	];
	return (await ghJson<PrSummary[]>(args)) ?? [];
}

export async function createPR(opts: {
	title: string;
	body: string;
	base?: string;
	draft?: boolean;
}): Promise<{ url: string; number: number } | null> {
	const args = ["pr", "create", "--title", opts.title, "--body", opts.body];
	if (opts.base) args.push("--base", opts.base);
	if (opts.draft) args.push("--draft");
	const r = await gh(args);
	if (!r.ok) return null;
	// `gh pr create` prints the URL on the last line of stdout.
	const url = r.stdout.trim().split("\n").pop() ?? "";
	const num = Number.parseInt(url.split("/").pop() ?? "", 10);
	if (Number.isNaN(num) || !url.startsWith("https://")) return null;
	return { url, number: num };
}

export async function getRateState(): Promise<{
	callsInWindow: number;
	limitPerMin: number;
	cooldownUntilMs: number;
}> {
	pruneOldTimestamps();
	return {
		callsInWindow: callTimestamps.length,
		limitPerMin: DEFAULT_RATE_LIMIT_PER_MIN,
		cooldownUntilMs,
	};
}

/** Test-only: clear the rate-limit window between unit tests. */
export function _resetRateState(): void {
	callTimestamps.length = 0;
	cooldownUntilMs = 0;
}
