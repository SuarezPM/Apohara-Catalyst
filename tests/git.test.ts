import { describe, expect, test } from "bun:test";
import {
	detectRemoteFormat,
	detectRepositoryFromRemote,
	isValidOwnerName,
	isValidRepoName,
	parseGitRemoteUrl,
} from "../src/lib/git";

describe("git remote URL parsing", () => {
	describe("parseGitRemoteUrl", () => {
		test("parses SSH URL format", () => {
			const result = parseGitRemoteUrl("git@github.com:owner/repo.git");
			expect(result).toEqual({
				owner: "owner",
				repo: "repo",
				remoteUrl: "git@github.com:owner/repo.git",
			});
		});

		test("parses SSH URL without .git suffix", () => {
			const result = parseGitRemoteUrl("git@github.com:owner/repo");
			expect(result).toEqual({
				owner: "owner",
				repo: "repo",
				remoteUrl: "git@github.com:owner/repo",
			});
		});

		test("parses HTTPS URL format", () => {
			const result = parseGitRemoteUrl("https://github.com/owner/repo.git");
			expect(result).toEqual({
				owner: "owner",
				repo: "repo",
				remoteUrl: "https://github.com/owner/repo.git",
			});
		});

		test("parses HTTPS URL without .git suffix", () => {
			const result = parseGitRemoteUrl("https://github.com/owner/repo");
			expect(result).toEqual({
				owner: "owner",
				repo: "repo",
				remoteUrl: "https://github.com/owner/repo",
			});
		});

		test("parses git:// URL format", () => {
			const result = parseGitRemoteUrl("git://github.com/owner/repo.git");
			expect(result).toEqual({
				owner: "owner",
				repo: "repo",
				remoteUrl: "git://github.com/owner/repo.git",
			});
		});

		test("parses git:// URL without .git suffix", () => {
			const result = parseGitRemoteUrl("git://github.com/owner/repo");
			expect(result).toEqual({
				owner: "owner",
				repo: "repo",
				remoteUrl: "git://github.com/owner/repo",
			});
		});

		test("returns null for invalid/invalid URLs", () => {
			expect(parseGitRemoteUrl("")).toBeNull();
			expect(parseGitRemoteUrl("not-a-git-url")).toBeNull();
			expect(parseGitRemoteUrl("https://gitlab.com/owner/repo")).toBeNull();
			expect(parseGitRemoteUrl("https://github.com/")).toBeNull();
			expect(parseGitRemoteUrl("https://github.com/owner")).toBeNull();
		});

		test("handles URLs with underscores in owner/repo", () => {
			const result = parseGitRemoteUrl("git@github.com:my_org/my_repo.git");
			expect(result).toEqual({
				owner: "my_org",
				repo: "my_repo",
				remoteUrl: "git@github.com:my_org/my_repo.git",
			});
		});

		test("handles URLs with hyphens in owner/repo", () => {
			const result = parseGitRemoteUrl("https://github.com/my-org/my-repo.git");
			expect(result).toEqual({
				owner: "my-org",
				repo: "my-repo",
				remoteUrl: "https://github.com/my-org/my-repo.git",
			});
		});

		test("handles URLs with leading/trailing whitespace", () => {
			const result = parseGitRemoteUrl("  git@github.com:owner/repo.git  ");
			expect(result).toEqual({
				owner: "owner",
				repo: "repo",
				remoteUrl: "git@github.com:owner/repo.git",
			});
		});
	});

	describe("detectRemoteFormat", () => {
		test("detects SSH format", () => {
			expect(detectRemoteFormat("git@github.com:owner/repo")).toBe("ssh");
		});

		test("detects HTTPS format", () => {
			expect(detectRemoteFormat("https://github.com/owner/repo")).toBe("https");
		});

		test("detects git:// format", () => {
			expect(detectRemoteFormat("git://github.com/owner/repo")).toBe("git");
		});

		test("returns null for unknown formats", () => {
			expect(detectRemoteFormat("")).toBeNull();
			expect(detectRemoteFormat("not-a-url")).toBeNull();
			expect(detectRemoteFormat("https://gitlab.com/owner/repo")).toBeNull();
		});
	});

	describe("detectRepositoryFromRemote", () => {
		// This test relies on actual git remote in the test environment
		test("detects repository from actual git remote", () => {
			const result = detectRepositoryFromRemote("origin");
			// Will be null if not in a git repo or no remote configured
			// Just verify it returns the correct shape or null
			if (result !== null) {
				expect(result.owner).toBeDefined();
				expect(result.repo).toBeDefined();
				expect(result.remoteUrl).toBeDefined();
			}
		});
	});
});

describe("validation", () => {
	describe("isValidRepoName", () => {
		test("returns true for valid repo names", () => {
			expect(isValidRepoName("my-repo")).toBe(true);
			expect(isValidRepoName("my_repo")).toBe(true);
			expect(isValidRepoName("repo123")).toBe(true);
			expect(isValidRepoName("a")).toBe(true);
			expect(isValidRepoName("a".repeat(100))).toBe(true);
		});

		test("returns false for invalid repo names", () => {
			expect(isValidRepoName("")).toBe(false);
			expect(isValidRepoName("a".repeat(101))).toBe(false);
			expect(isValidRepoName("repo.git")).toBe(false);
			expect(isValidRepoName("repo.hook")).toBe(false);
			expect(isValidRepoName("repo~")).toBe(false);
			expect(isValidRepoName("repo^")).toBe(false);
			expect(isValidRepoName("repo?")).toBe(false);
			expect(isValidRepoName("repo*")).toBe(false);
			expect(isValidRepoName("repo[")).toBe(false);
			expect(isValidRepoName("repo\\")).toBe(false);
		});
	});

	describe("isValidOwnerName", () => {
		test("returns true for valid owner names", () => {
			expect(isValidOwnerName("my-org")).toBe(true);
			expect(isValidOwnerName("my_org")).toBe(true);
			expect(isValidOwnerName("owner123")).toBe(true);
			expect(isValidOwnerName("a")).toBe(true);
			expect(isValidOwnerName("a".repeat(39))).toBe(true);
		});

		test("returns false for invalid owner names", () => {
			expect(isValidOwnerName("")).toBe(false);
			expect(isValidOwnerName("a".repeat(40))).toBe(false);
			expect(isValidOwnerName("-startswithdash")).toBe(false);
			expect(isValidOwnerName("_startswithunderscore")).toBe(false);
			expect(isValidOwnerName("has spaces")).toBe(false);
			expect(isValidOwnerName("has/slash")).toBe(false);
		});
	});
});
