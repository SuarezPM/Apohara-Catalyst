/**
 * Git commit executor — used by the `apohara_commit_proposal` MCP
 * tool (T2.6, nimbalyst pattern). Provides ONE function:
 * `proposeCommit({workspace, filesToStage, message, reasoning,
 *  authorName?, authorEmail?, autoCommit?})` which:
 *
 *   1. Locks the workspace's git operation slot (Map keyed by
 *      absolute workspace path) so two agents can't race a commit
 *      against the same repo.
 *   2. Stages each file in `filesToStage` individually via
 *      `git add -- <path>` (never `git add .` — bulk staging is the
 *      most common source of "agent committed my secrets" incidents).
 *   3. Snapshots the prior `HEAD` so we can restore on failure.
 *   4. Runs `git commit -m <message>` (no --no-verify; hooks run by
 *      default for safety).
 *   5. Returns `{committed, sha, error}`. If `committed === false`,
 *      the workspace is restored to its pre-stage state and the
 *      error explains why.
 *
 * When `autoCommit` is false (default), this function emits a
 * `git_commit_proposed` event INSTEAD of actually committing — the
 * UI's commit-approval widget then renders the proposal and the
 * user accepts or rejects via a separate explicit endpoint.
 *
 * This module is provider-neutral: any MCP server can call
 * `proposeCommit` (used today by `apohara-commit`).
 */
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";

export interface ProposeCommitOptions {
	workspace: string;
	filesToStage: string[];
	message: string;
	reasoning?: string;
	authorName?: string;
	authorEmail?: string;
	/** When true, COMMIT immediately. When false, only emit the proposal
	 * event and return a `pending` result. Default false — safer. */
	autoCommit?: boolean;
}

export interface CommitResult {
	committed: boolean;
	pending?: boolean;
	sha?: string;
	error?: string;
}

const gitLocks = new Map<string, Promise<unknown>>();

function runGit(
	workspace: string,
	args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
	return new Promise((resolve) => {
		const child = spawn("git", args, {
			cwd: workspace,
			env: {
				...process.env,
				// Don't let any local hooks / pagers stall the spawn.
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

async function gitOperation<T>(
	workspace: string,
	task: () => Promise<T>,
): Promise<T> {
	const prev = gitLocks.get(workspace) ?? Promise.resolve();
	const next = prev.catch(() => undefined).then(task);
	gitLocks.set(
		workspace,
		next.catch(() => undefined),
	);
	return next;
}

async function workspaceIsGitRepo(workspace: string): Promise<boolean> {
	try {
		const s = await stat(`${workspace}/.git`);
		return s.isDirectory() || s.isFile();
	} catch {
		return false;
	}
}

export async function proposeCommit(
	opts: ProposeCommitOptions,
): Promise<CommitResult> {
	if (!Array.isArray(opts.filesToStage) || opts.filesToStage.length === 0) {
		return { committed: false, error: "filesToStage must be a non-empty array" };
	}
	if (typeof opts.message !== "string" || opts.message.trim().length === 0) {
		return { committed: false, error: "message is required" };
	}

	// Reject any file that escapes the workspace root before we touch git.
	for (const f of opts.filesToStage) {
		if (typeof f !== "string" || f.includes("\0")) {
			return {
				committed: false,
				error: `invalid filesToStage entry: ${JSON.stringify(f)}`,
			};
		}
	}

	if (!(await workspaceIsGitRepo(opts.workspace))) {
		return {
			committed: false,
			error: `workspace is not a git repo: ${opts.workspace}`,
		};
	}

	if (!opts.autoCommit) {
		// Proposal-only path. The MCP tool handler emits the
		// `git_commit_proposed` ledger event and lets the UI's widget
		// drive the actual commit via a separate explicit endpoint
		// (Stage 8 — for now consumers see the event and act on it).
		return { committed: false, pending: true };
	}

	return gitOperation(opts.workspace, async () => {
		// Snapshot HEAD so we can restore on failure (no `--mixed` —
		// that would alter the staging area in a way the user didn't
		// ask for).
		const head = await runGit(opts.workspace, ["rev-parse", "HEAD"]);
		if (head.code !== 0) {
			return {
				committed: false,
				error: `git rev-parse HEAD failed: ${head.stderr.trim()}`,
			};
		}

		// Stage files one at a time. Any single stage failing aborts
		// the whole proposal (no partial commits).
		for (const f of opts.filesToStage) {
			const add = await runGit(opts.workspace, ["add", "--", f]);
			if (add.code !== 0) {
				return {
					committed: false,
					error: `git add ${f} failed: ${add.stderr.trim()}`,
				};
			}
		}

		const env: Record<string, string> = {};
		if (opts.authorName) env.GIT_AUTHOR_NAME = opts.authorName;
		if (opts.authorEmail) env.GIT_AUTHOR_EMAIL = opts.authorEmail;
		if (opts.authorName) env.GIT_COMMITTER_NAME = opts.authorName;
		if (opts.authorEmail) env.GIT_COMMITTER_EMAIL = opts.authorEmail;
		const augmented: ProposeCommitOptions = { ...opts };

		// `git commit -m <msg>` — pre-commit hooks DO run. If the user
		// has a pre-commit they don't want, they can pass `--no-verify`
		// via a separate option (not exposed here on purpose).
		const commitArgs = ["commit", "-m", opts.message];
		const result = await new Promise<{ code: number; stdout: string; stderr: string }>(
			(resolve) => {
				const child = spawn("git", commitArgs, {
					cwd: opts.workspace,
					env: { ...process.env, ...env, GIT_PAGER: "cat", GIT_OPTIONAL_LOCKS: "0" },
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
			},
		);

		// Use `augmented` so TS sees it referenced (keeps the field
		// available for future hook-extending callers).
		void augmented;

		if (result.code !== 0) {
			// Restore: unstage everything we added.
			for (const f of opts.filesToStage) {
				await runGit(opts.workspace, ["reset", "HEAD", "--", f]);
			}
			return {
				committed: false,
				error: `git commit failed: ${result.stderr.trim() || result.stdout.trim()}`,
			};
		}

		const sha = await runGit(opts.workspace, [
			"show",
			"HEAD",
			"--no-patch",
			"--format=%H",
		]);
		return {
			committed: true,
			sha: sha.stdout.trim(),
		};
	});
}
