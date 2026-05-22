/**
 * apohara.commit MCP server — exposes the `apohara_commit_proposal`
 * tool (T2.6, nimbalyst pattern).
 *
 * The agent calls this tool with `{filesToStage, message, reasoning}`.
 * Apohara writes a `git_commit_proposed` ledger event so the
 * approval widget in the UI can render the proposal alongside the
 * diff, and the user explicitly accepts/rejects via a separate
 * surface.
 *
 * When `auto_commit` is true (settings-driven via `apohara.settings`
 * tool, or env override `APOHARA_AUTO_COMMIT=1`), the tool DOES the
 * commit synchronously and returns the new SHA — no widget round-
 * trip. Default is OFF so agents can't push to history without the
 * user's blessing.
 */
import { appendFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { proposeCommit } from "../../git/commit.js";
import {
	requireString,
	optionalString,
	optionalStringArray,
} from "../base/inputValidation.js";
import { McpServer, type ToolRegistration } from "../base/McpServer.js";

export interface CommitServerOpts {
	workspace: string;
	/** Where to append the `git_commit_proposed` ledger event. The
	 * caller (bun server) hands the active session's ledger path. */
	ledgerPath: string;
	serverName?: string;
	port: number;
	bearerToken: string;
	auditLogPath: string;
	/** When true, commit immediately on tool call. Default false. */
	autoCommit?: boolean;
}

export function buildCommitTools(
	opts: Pick<CommitServerOpts, "workspace" | "ledgerPath" | "autoCommit">,
): ToolRegistration[] {
	return [
		{
			name: "apohara_commit_proposal",
			handler: async (input) => {
				const message = requireString(input, "commitMessage");
				const filesToStage = optionalStringArray(input, "filesToStage");
				if (!filesToStage || filesToStage.length === 0) {
					throw new Error("filesToStage must be a non-empty array of strings");
				}
				const reasoning = optionalString(input, "reasoning");

				// Always emit the proposal event so consumers (UI widget,
				// audit log, future review tools) see it regardless of
				// whether we go on to commit.
				const proposalId = randomUUID();
				const proposalEvent = {
					id: proposalId,
					timestamp: new Date().toISOString(),
					type: "git_commit_proposed",
					severity: "info",
					payload: {
						filesToStage,
						commitMessage: message,
						reasoning: reasoning ?? null,
						autoCommit: opts.autoCommit === true,
					},
				};
				try {
					await appendFile(
						opts.ledgerPath,
						`${JSON.stringify(proposalEvent)}\n`,
						"utf-8",
					);
				} catch {
					// Best-effort — never block the commit just because
					// we couldn't observe it.
				}

				const result = await proposeCommit({
					workspace: opts.workspace,
					filesToStage,
					message,
					reasoning,
					autoCommit: opts.autoCommit === true,
				});

				if (result.committed) {
					await appendFile(
						opts.ledgerPath,
						`${JSON.stringify({
							id: randomUUID(),
							timestamp: new Date().toISOString(),
							type: "git_commit_landed",
							severity: "info",
							payload: { proposalId, sha: result.sha, filesToStage },
						})}\n`,
						"utf-8",
					).catch(() => {});
				} else if (!result.pending) {
					await appendFile(
						opts.ledgerPath,
						`${JSON.stringify({
							id: randomUUID(),
							timestamp: new Date().toISOString(),
							type: "git_commit_rejected",
							severity: "error",
							payload: { proposalId, error: result.error },
						})}\n`,
						"utf-8",
					).catch(() => {});
				}

				return {
					proposalId,
					committed: result.committed,
					pending: result.pending ?? false,
					sha: result.sha,
					error: result.error,
				};
			},
		},
	];
}

export function startCommitServer(opts: CommitServerOpts) {
	const mcp = new McpServer({
		serverName: opts.serverName ?? "apohara.commit",
		port: opts.port,
		bearerToken: opts.bearerToken,
		auditLogPath: opts.auditLogPath,
	});
	for (const tool of buildCommitTools({
		workspace: opts.workspace,
		ledgerPath: opts.ledgerPath,
		autoCommit: opts.autoCommit ?? process.env.APOHARA_AUTO_COMMIT === "1",
	})) {
		mcp.register(tool);
	}
	return mcp.start();
}
