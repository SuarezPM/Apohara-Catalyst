/**
 * Worktree status via `git cherry` — G5.I.6 (nimbalyst inspiration).
 *
 * `git rev-list --count base..head` answers "how many commits are on `head`
 * that base hasn't seen?". The answer over-counts in the common subagent
 * workflow: when a subagent's branch contains commits that are *already*
 * present on base (e.g. they were cherry-picked back, or the base branch
 * has merged them but with a different SHA), we want a count of UNIQUE
 * work, not raw rev-list count.
 *
 * `git cherry <base> <head>` walks both sides and prints one line per commit
 * in `head` prefixed with `+` (unique to head) or `-` (equivalent to a
 * commit on base). We expose `uniqueCommitsAhead(...)` that counts only the
 * `+` lines — the spec §0 framing for "how much work does this worktree
 * actually carry?".
 */
import { spawn } from "node:child_process";

export interface CherryStatusOptions {
	workspace: string;
	base: string;
	head: string;
}

interface RunResult {
	code: number;
	stdout: string;
	stderr: string;
}

function runGit(workspace: string, args: string[]): Promise<RunResult> {
	return new Promise((resolve) => {
		const child = spawn("git", args, {
			cwd: workspace,
			env: {
				...process.env,
				GIT_PAGER: "cat",
				GIT_OPTIONAL_LOCKS: "0",
			},
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout?.on("data", (c) => (stdout += c.toString("utf-8")));
		child.stderr?.on("data", (c) => (stderr += c.toString("utf-8")));
		child.on("close", (code) =>
			resolve({ code: code ?? -1, stdout, stderr }),
		);
		child.on("error", (err) =>
			resolve({ code: -1, stdout, stderr: err.message }),
		);
	});
}

/**
 * Validate a git refname argument. Rejects anything that could be a flag,
 * shell injection, or path traversal — `--`-prefixed args, NUL bytes, leading
 * dashes, and `..` in the absence of the explicit range operator.
 */
function isSafeRef(ref: string): boolean {
	if (typeof ref !== "string" || ref.length === 0) return false;
	if (ref.startsWith("-")) return false;
	if (ref.includes("\0")) return false;
	if (ref.includes(" ")) return false;
	// `..` is reserved for git range syntax — cherry takes two separate refs.
	if (ref.includes("..")) return false;
	return true;
}

/**
 * Count commits unique to `head` (relative to `base`) using `git cherry`.
 *
 * Returns `-1` if git fails (caller decides whether to bail or treat as
 * "unknown"). Does NOT throw on git failure — error is in `error`.
 */
export async function uniqueCommitsAhead(
	opts: CherryStatusOptions,
): Promise<{ count: number; error?: string }> {
	if (!isSafeRef(opts.base)) {
		return { count: -1, error: `invalid base ref: ${opts.base}` };
	}
	if (!isSafeRef(opts.head)) {
		return { count: -1, error: `invalid head ref: ${opts.head}` };
	}
	const res = await runGit(opts.workspace, [
		"cherry",
		"--",
		opts.base,
		opts.head,
	]);
	if (res.code !== 0) {
		return {
			count: -1,
			error: `git cherry failed (code ${res.code}): ${res.stderr.trim()}`,
		};
	}
	let count = 0;
	for (const line of res.stdout.split("\n")) {
		if (line.startsWith("+ ")) count += 1;
	}
	return { count };
}
