import { execSync } from "node:child_process";

/**
 * Result of parsing a git remote URL.
 */
export interface GitRemoteInfo {
	owner: string;
	repo: string;
	remoteUrl: string;
}

/**
 * Supported git remote URL formats.
 */
type GitRemoteFormat = "ssh" | "https" | "git";

/**
 * Parses a git remote URL to extract owner and repository name.
 * Supports SSH format: git@github.com:owner/repo.git
 * Supports HTTPS format: https://github.com/owner/repo.git
 * Supports git:// format: git://github.com/owner/repo.git
 *
 * @param remoteUrl - The git remote URL to parse
 * @returns Parsed repository info or null if URL format is not recognized
 */
export function parseGitRemoteUrl(remoteUrl: string): GitRemoteInfo | null {
	if (!remoteUrl || typeof remoteUrl !== "string") {
		return null;
	}

	const trimmed = remoteUrl.trim();
	if (!trimmed) {
		return null;
	}

	let match: RegExpMatchArray | null;

	// SSH format: git@github.com:owner/repo.git
	match = trimmed.match(/git@github\.com:([^/]+)\/([^/.]+?)(?:\.git)?$/);
	if (match) {
		return {
			owner: match[1],
			repo: match[2],
			remoteUrl: trimmed,
		};
	}

	// HTTPS format: https://github.com/owner/repo.git
	match = trimmed.match(/https:\/\/github\.com\/([^/]+)\/([^/.]+?)(?:\.git)?$/);
	if (match) {
		return {
			owner: match[1],
			repo: match[2],
			remoteUrl: trimmed,
		};
	}

	// git:// format: git://github.com/owner/repo.git
	match = trimmed.match(/git:\/\/github\.com\/([^/]+)\/([^/.]+?)(?:\.git)?$/);
	if (match) {
		return {
			owner: match[1],
			repo: match[2],
			remoteUrl: trimmed,
		};
	}

	return null;
}

/**
 * Detects the format of a git remote URL.
 */
export function detectRemoteFormat(remoteUrl: string): GitRemoteFormat | null {
	if (!remoteUrl) return null;

	if (remoteUrl.includes("git@github.com")) {
		return "ssh";
	}
	if (remoteUrl.startsWith("https://github.com")) {
		return "https";
	}
	if (remoteUrl.startsWith("git://github.com")) {
		return "git";
	}

	return null;
}

/**
 * Gets the remote URL from a local git repository.
 *
 * @param remoteName - The name of the remote (default: "origin")
 * @returns The remote URL or null if not found
 */
export function getGitRemoteUrl(remoteName: string = "origin"): string | null {
	try {
		const url = execSync(`git remote get-url ${remoteName}`, {
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
		return url || null;
	} catch {
		return null;
	}
}

/**
 * Detects repository information from the local git remote.
 * Convenience function that combines getGitRemoteUrl and parseGitRemoteUrl.
 *
 * @param remoteName - The name of the remote (default: "origin")
 * @returns Parsed repository info or null if not a git repo or no remote
 */
export function detectRepositoryFromRemote(
	remoteName: string = "origin",
): GitRemoteInfo | null {
	const remoteUrl = getGitRemoteUrl(remoteName);
	if (!remoteUrl) {
		return null;
	}
	return parseGitRemoteUrl(remoteUrl);
}

/**
 * Validates that a repository name follows GitHub conventions.
 * Repository names must:
 * - Be 1-100 characters
 * - Not contain certain special characters
 * - Not end with .git
 *
 * @param repoName - The repository name to validate
 * @returns True if valid, false otherwise
 */
export function isValidRepoName(repoName: string): boolean {
	if (!repoName || repoName.length === 0 || repoName.length > 100) {
		return false;
	}

	// Repository names cannot contain certain characters
	if (/[~^:?*[\\]/.test(repoName)) {
		return false;
	}

	// Cannot end with .git or .hook
	if (repoName.endsWith(".git") || repoName.endsWith(".hook")) {
		return false;
	}

	return true;
}

/**
 * Validates that an owner name follows GitHub conventions.
 * Owner names (usernames/organizations) must:
 * - Be 1-39 characters
 * - Start with alphanumeric
 * - Only contain alphanumeric, hyphens, and underscores
 *
 * @param ownerName - The owner name to validate
 * @returns True if valid, false otherwise
 */
export function isValidOwnerName(ownerName: string): boolean {
	if (!ownerName || ownerName.length === 0 || ownerName.length > 39) {
		return false;
	}

	// Must start with alphanumeric
	if (!/^[a-zA-Z0-9]/.test(ownerName)) {
		return false;
	}

	// Only alphanumeric, hyphens, and underscores
	if (!/^[a-zA-Z0-9_-]+$/.test(ownerName)) {
		return false;
	}

	return true;
}
