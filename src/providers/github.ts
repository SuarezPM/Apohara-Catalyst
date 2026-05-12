import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { config } from "../core/config";
import type { EventLog, EventSeverity } from "../core/types";

/**
 * GitHub API Client with authentication handling.
 * Provides structured error logging for GitHub API failures (401, 403, rate limits).
 */
export class GitHubClient {
	private readonly API_BASE = "https://api.github.com";
	private token: string | undefined;

	// Event ledger for observability
	private ledgerPath: string;
	private ledgerInitialized = false;

	constructor(token?: string | undefined) {
		// Only use config if token was not explicitly provided (undefined)
		// Explicitly pass empty string or other falsy values to override config
		if (token === undefined) {
			this.token = config.GITHUB_TOKEN;
		} else {
			this.token = token;
		}

		// Initialize ledger path
		const runId = new Date().toISOString().replace(/[:.]/g, "-");
		this.ledgerPath = join(process.cwd(), ".events", `run-${runId}.jsonl`);
	}

	/**
	 * Initializes the ledger directory.
	 */
	private async initLedger(): Promise<void> {
		if (this.ledgerInitialized) return;
		await mkdir(dirname(this.ledgerPath), { recursive: true });
		this.ledgerInitialized = true;
	}

	/**
	 * Logs an event to the ledger for GitHub API events.
	 */
	private async logEvent(
		type: string,
		payload: Record<string, unknown>,
		severity: EventSeverity = "info",
	): Promise<void> {
		await this.initLedger();

		const event: EventLog = {
			id: randomUUID(),
			timestamp: new Date().toISOString(),
			type,
			severity,
			payload,
			metadata: {},
		};

		const line = `${JSON.stringify(event)}\n`;
		await appendFile(this.ledgerPath, line, "utf-8");

		// Also log to console for real-time visibility
		const consoleMsg = `[${type.toUpperCase()}] ${payload.message || JSON.stringify(payload)}`;
		if (severity === "warning") {
			console.warn(consoleMsg);
		} else if (severity === "error") {
			console.error(consoleMsg);
		} else {
			console.log(consoleMsg);
		}
	}

	/**
	 * Validates that the GitHub token is present and configured.
	 */
	public validateToken(): { valid: boolean; error?: string } {
		if (!this.token || this.token.trim() === "") {
			return {
				valid: false,
				error:
					"GITHUB_TOKEN is not configured. Set GITHUB_TOKEN environment variable.",
			};
		}

		if (this.token.length < 10) {
			return {
				valid: false,
				error: "GITHUB_TOKEN appears to be malformed (too short).",
			};
		}

		// Check if it looks like a GitHub token (starts with gho_, ghp_, gh_, ghs_)
		const validPrefixes = ["gho_", "ghp_", "gh_", "ghs_"];
		if (!validPrefixes.some((prefix) => this.token?.startsWith(prefix))) {
			return {
				valid: false,
				error:
					"GITHUB_TOKEN does not appear to be a valid GitHub token format (should start with gho_, ghp_, gh_, or ghs_).",
			};
		}

		return { valid: true };
	}

	/**
	 * Makes an authenticated request to the GitHub API.
	 */
	private async apiRequest<T>(
		endpoint: string,
		options: RequestInit = {},
	): Promise<T> {
		const tokenValidation = this.validateToken();
		if (!tokenValidation.valid) {
			throw new Error(`GitHub Authentication Error: ${tokenValidation.error}`);
		}

		const url = `${this.API_BASE}${endpoint}`;
		const headers: Record<string, string> = {
			Accept: "application/vnd.github.v3+json",
			"User-Agent": "Clarity-Code/1.0",
			...((options.headers as Record<string, string>) || {}),
		};

		// Add auth header
		headers.Authorization = `Bearer ${this.token}`;

		const response = await fetch(url, {
			...options,
			headers,
			signal: AbortSignal.timeout(30000), // 30 second timeout
		});

		// Handle different error types with structured logging
		if (response.status === 401) {
			await this.logEvent(
				"github_auth_failure",
				{
					message: "GitHub API authentication failed (401 Unauthorized)",
					endpoint,
					cause: "Invalid or expired token",
					action: "Check that GITHUB_TOKEN is valid and not expired",
				},
				"error",
			);
			throw new Error(
				"GitHub Authentication Error: 401 Unauthorized. Token may be invalid or expired.",
			);
		}

		if (response.status === 403) {
			// Check for rate limiting
			const rateLimitRemaining = response.headers.get("X-RateLimit-Remaining");
			const rateLimitReset = response.headers.get("X-RateLimit-Reset");

			if (rateLimitRemaining === "0") {
				const resetTime = rateLimitReset
					? new Date(Number(rateLimitReset) * 1000).toISOString()
					: "unknown";
				await this.logEvent(
					"github_rate_limit",
					{
						message: "GitHub API rate limit exceeded (403)",
						endpoint,
						rateLimitRemaining: rateLimitRemaining,
						rateLimitReset: resetTime,
						cause: "API rate limit exceeded",
						action: "Wait until the rate limit resets or use a different token",
					},
					"error",
				);
				throw new Error(
					`GitHub API Error: 403 Rate Limit Exceeded. Resets at ${resetTime}`,
				);
			}

			await this.logEvent(
				"github_forbidden",
				{
					message: "GitHub API request forbidden (403)",
					endpoint,
					cause: "Insufficient permissions or API access blocked",
					action: "Check token scopes and repository access",
				},
				"error",
			);
			throw new Error(
				"GitHub API Error: 403 Forbidden. Check token scopes and repository access.",
			);
		}

		if (response.status === 404) {
			await this.logEvent(
				"github_not_found",
				{
					message: "GitHub API resource not found (404)",
					endpoint,
					cause: "Repository or resource does not exist",
				},
				"warning",
			);
			throw new Error(`GitHub API Error: 404 Not Found - ${endpoint}`);
		}

		if (!response.ok) {
			const errorText = await response.text().catch(() => "Unknown error");
			await this.logEvent(
				"github_api_error",
				{
					message: `GitHub API error: ${response.status} ${response.statusText}`,
					endpoint,
					status: response.status,
					error: errorText,
				},
				"error",
			);
			throw new Error(
				`GitHub API Error: ${response.status} ${response.statusText}`,
			);
		}

		return response.json() as Promise<T>;
	}

	/**
	 * Gets the current user from GitHub API.
	 */
	public async getCurrentUser(): Promise<{
		login: string;
		id: number;
		name?: string;
		email?: string;
	}> {
		return this.apiRequest("/user");
	}

	/**
	 * Gets repository information by owner and repo name.
	 */
	public async getRepository(
		owner: string,
		repo: string,
	): Promise<{
		id: number;
		name: string;
		fullName: string;
		private: boolean;
		htmlUrl: string;
		defaultBranch: string;
	}> {
		return this.apiRequest(`/repos/${owner}/${repo}`);
	}

	/**
	 * Detects repository information from local git remote.
	 * Parses the git remote URL to extract owner and repository name.
	 */
	public detectRepositoryFromRemote(): {
		owner: string;
		repo: string;
		remoteUrl: string;
	} | null {
		try {
			// Get the remote URL (prefer origin)
			const remoteUrl = execSync("git remote get-url origin", {
				encoding: "utf-8",
				stdio: ["pipe", "pipe", "pipe"],
			}).trim();

			if (!remoteUrl) {
				return null;
			}

			// Parse different Git URL formats
			let match: RegExpMatchArray | null;

			// SSH format: git@github.com:owner/repo.git
			match = remoteUrl.match(/git@github\.com:([^/]+)\/([^/.]+?)(?:\.git)?$/);
			if (match) {
				return {
					owner: match[1],
					repo: match[2],
					remoteUrl,
				};
			}

			// HTTPS format: https://github.com/owner/repo.git
			match = remoteUrl.match(
				/https:\/\/github\.com\/([^/]+)\/([^/.]+?)(?:\.git)?$/,
			);
			if (match) {
				return {
					owner: match[1],
					repo: match[2],
					remoteUrl,
				};
			}

			// If we can't parse, return what we have
			return null;
		} catch {
			// No git remote or not a git repository
			return null;
		}
	}

	/**
	 * Authenticates with GitHub and validates the token.
	 * Returns user info on success, throws error on failure.
	 */
	public async authenticate(): Promise<{
		login: string;
		id: number;
		authenticated: boolean;
	}> {
		const tokenValidation = this.validateToken();
		if (!tokenValidation.valid) {
			await this.logEvent(
				"github_auth_validation_failed",
				{
					message: tokenValidation.error,
					authenticated: false,
				},
				"error",
			);
			throw new Error(`GitHub Authentication Error: ${tokenValidation.error}`);
		}

		try {
			const user = await this.getCurrentUser();
			await this.logEvent(
				"github_auth_success",
				{
					message: `Successfully authenticated as ${user.login}`,
					user: user.login,
					authenticated: true,
				},
				"info",
			);

			return {
				login: user.login,
				id: user.id,
				authenticated: true,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			await this.logEvent(
				"github_auth_error",
				{
					message: `Authentication failed: ${message}`,
					authenticated: false,
				},
				"error",
			);
			throw error;
		}
	}

	/**
	 * Gets repository info from local git remote.
	 * Combines detectRepositoryFromRemote with GitHub API validation.
	 */
	public async getRepositoryFromRemote(): Promise<{
		owner: string;
		repo: string;
		remoteUrl: string;
		repoInfo: {
			id: number;
			private: boolean;
			htmlUrl: string;
			defaultBranch: string;
		} | null;
	} | null> {
		const remote = this.detectRepositoryFromRemote();
		if (!remote) {
			return null;
		}

		try {
			const repoInfo = await this.getRepository(remote.owner, remote.repo);
			return {
				...remote,
				repoInfo: {
					id: repoInfo.id,
					private: repoInfo.private,
					htmlUrl: repoInfo.htmlUrl,
					defaultBranch: repoInfo.defaultBranch,
				},
			};
		} catch {
			// Repository may not exist or token lacks access
			return {
				...remote,
				repoInfo: null,
			};
		}
	}

	/**
	 * Creates a pull request on GitHub.
	 * Calls POST /repos/{owner}/{repo}/pulls
	 */
	public async createPullRequest(options: {
		owner: string;
		repo: string;
		title: string;
		body?: string;
		head: string;
		base: string;
	}): Promise<{
		number: number;
		htmlUrl: string;
		state: string;
		title: string;
		head: { ref: string; sha: string };
		base: { ref: string };
	}> {
		const { owner, repo, title, body, head, base } = options;

		try {
			const pr = await this.apiRequest<{
				number: number;
				html_url: string;
				state: string;
				title: string;
				head: { ref: string; sha: string };
				base: { ref: string };
			}>(`/repos/${owner}/${repo}/pulls`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					title,
					body: body ?? "",
					head,
					base,
				}),
			});

			await this.logEvent(
				"github_pr_created",
				{
					message: `PR #${pr.number} created: "${pr.title}"`,
					prNumber: pr.number,
					prUrl: pr.html_url,
					head: head,
					base: base,
					repository: `${owner}/${repo}`,
				},
				"info",
			);

			return {
				number: pr.number,
				htmlUrl: pr.html_url,
				state: pr.state,
				title: pr.title,
				head: pr.head,
				base: pr.base,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			await this.logEvent(
				"github_pr_error",
				{
					message: `Failed to create PR: ${message}`,
					cause: message,
					endpoint: `/repos/${owner}/${repo}/pulls`,
					action: "Check that the head branch exists and you have push access",
					repository: `${owner}/${repo}`,
					head,
					base,
				},
				"error",
			);
			throw error;
		}
	}
}
