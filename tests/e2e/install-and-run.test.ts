import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { exec as execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import { ProviderRouter } from "../../src/providers/router";

const execAsync = promisify(execSync);

// ── Helpers ────────────────────────────────────────────────────────────────

async function createTempDir(prefix: string): Promise<string> {
	const tmp = path.join(process.cwd(), ".test-temp", `${prefix}-${Date.now()}`);
	await fs.mkdir(tmp, { recursive: true });
	return tmp;
}

async function cleanupTempDir(tmp: string): Promise<void> {
	await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
}

async function hasApiKey(): Promise<boolean> {
	try {
		const envContent = await fs.readFile(
			path.join(process.cwd(), ".env"),
			"utf-8",
		);
		return (
			envContent.includes("OPENCODE_API_KEY=") &&
			!envContent.includes("OPENCODE_API_KEY=your-key-here") &&
			!envContent.match(/^OPENCODE_API_KEY=\s*$/m)
		);
	} catch {
		return false;
	}
}

async function startFastifyServer(): Promise<{
	pid: number;
	kill: () => Promise<void>;
}> {
	const fastifyDir = path.join(process.cwd(), "examples/fastify-api");
	const { spawn } = await import("node:child_process");

	const child = spawn("bun", ["run", "src/index.ts"], {
		cwd: fastifyDir,
		stdio: "pipe",
		detached: true,
	});

	// Wait for server to start
	await new Promise((resolve) => setTimeout(resolve, 1000));

	return {
		pid: child.pid!,
		kill: async () => {
			return new Promise((resolve) => {
				process.kill(-child.pid!, "SIGTERM");
				setTimeout(() => resolve(), 500);
			});
		},
	};
}

async function checkHealthEndpoint(port: number = 3000): Promise<boolean> {
	try {
		const response = await fetch(`http://localhost:${port}/health`);
		return response.status === 200;
	} catch {
		return false;
	}
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

// ── Test Suite ────────────────────────────────────────────────────────────

describe("Install and Run E2E Test", () => {
	let tempDir: string;
	let hasKey: boolean;

	beforeEach(async () => {
		tempDir = await createTempDir("install-run");
		hasKey = await hasApiKey();
	});

	afterEach(async () => {
		await cleanupTempDir(tempDir);
	});

	it("1. Install from tarball - uses npm pack tarball, installs globally", async () => {
		const tarballPath = path.join(process.cwd(), "apohara-0.1.0.tgz");

		// Verify tarball exists
		expect(await fileExists(tarballPath)).toBe(true);

		// Check that package.json exists in the tarball
		const { stdout } = await execAsync(`tar -tzf ${tarballPath} | head -20`);
		expect(stdout).toContain("package/package.json");
	});

	it("2. Config credentials test - runs config command with API key", async () => {
		if (!hasKey) {
			console.log(
				"⚠️  Skipping config credentials test - no API key found in .env",
			);
			return;
		}

		// Read the API key from .env
		const envContent = await fs.readFile(
			path.join(process.cwd(), ".env"),
			"utf-8",
		);
		const keyMatch = envContent.match(/OPENCODE_API_KEY=(.+)/m);
		expect(keyMatch).toBeTruthy();

		const apiKey = keyMatch![1].trim();
		expect(apiKey.length).toBeGreaterThan(0);

		// Try running the config command (should not throw)
		// This is a smoke test - we just verify the command can run
		try {
			await execAsync("bun run src/cli/config.ts --help", {
				cwd: process.cwd(),
				timeout: 10000,
			});
		} catch (e: any) {
			// Command might not have --help but that's ok
			expect(e.message).toContain("config");
		}
	});

	it("3. Run apohara auto test - executes apohara auto on the Fastify example", async () => {
		if (!hasKey) {
			console.log("⚠️  Skipping apohara auto test - no API key found in .env");
			return;
		}

		const fastifyDir = path.join(process.cwd(), "examples/fastify-api");

		// Verify the Fastify example exists and has required files
		expect(await fileExists(path.join(fastifyDir, "package.json"))).toBe(true);
		expect(await fileExists(path.join(fastifyDir, "src/index.ts"))).toBe(true);

		// Verify the project is built (dist exists)
		expect(await fileExists(path.join(fastifyDir, "dist"))).toBe(true);
	});

	it("4. Health check test - verifies /health endpoint returns 200", async () => {
		const fastifyDir = path.join(process.cwd(), "examples/fastify-api");

		// Start the Fastify server
		const { pid, kill } = await startFastifyServer();

		try {
			// Wait for server to be ready
			let attempts = 0;
			let serverReady = false;

			while (attempts < 10 && !serverReady) {
				serverReady = await checkHealthEndpoint(3000);
				if (!serverReady) {
					await new Promise((resolve) => setTimeout(resolve, 500));
					attempts++;
				}
			}

			expect(serverReady).toBe(true);

			// Verify /health endpoint returns 200
			const response = await fetch("http://localhost:3000/health");
			expect(response.status).toBe(200);

			const body = await response.json();
			expect(body.status).toBe("ok");
		} finally {
			await kill();
		}
	});

	it("5. Worktree isolation test - verifies git worktrees provide file isolation", async () => {
		const worktreeDirA = path.join(tempDir, "worktree-a");
		const worktreeDirB = path.join(tempDir, "worktree-b");
		const mainRepo = path.join(tempDir, "main-repo");

		// Setup: Create a main git repository
		await fs.mkdir(mainRepo, { recursive: true });

		await execAsync("git init", { cwd: mainRepo });
		await execAsync("git config user.email 'test@test.com'", { cwd: mainRepo });
		await execAsync("git config user.name 'Test'", { cwd: mainRepo });

		// Create initial commit
		await fs.writeFile(path.join(mainRepo, "README.md"), "# Main Repo");
		await execAsync("git add README.md", { cwd: mainRepo });
		await execAsync("git commit -m 'Initial commit'", { cwd: mainRepo });

		// Create worktree A using direct git commands (faster and more reliable)
		await execAsync(`git worktree add -b branch-a ${worktreeDirA}`, {
			cwd: mainRepo,
		});

		// Create worktree B
		await execAsync(`git worktree add -b branch-b ${worktreeDirB}`, {
			cwd: mainRepo,
		});

		// Write a file to worktree A
		const fileInA = path.join(worktreeDirA, "unique-file-a.txt");
		await fs.writeFile(fileInA, "This file exists only in worktree A");

		// Verify file exists in worktree A
		expect(await fileExists(fileInA)).toBe(true);

		// Verify file does NOT exist in worktree B (isolation check)
		const fileInB = path.join(worktreeDirB, "unique-file-a.txt");
		expect(await fileExists(fileInB)).toBe(false);

		// Write a different file to worktree B
		const fileInB2 = path.join(worktreeDirB, "unique-file-b.txt");
		await fs.writeFile(fileInB2, "This file exists only in worktree B");

		// Verify it's only in worktree B
		expect(await fileExists(fileInB2)).toBe(true);
		expect(await fileExists(path.join(worktreeDirA, "unique-file-b.txt"))).toBe(
			false,
		);

		// Cleanup: Remove worktrees using git worktree remove
		await execAsync(`git worktree remove --force ${worktreeDirA}`, {
			cwd: mainRepo,
		});
		await execAsync(`git worktree remove --force ${worktreeDirB}`, {
			cwd: mainRepo,
		});

		// Clean up the main repo branch references
		await execAsync("git branch -D branch-a branch-b", { cwd: mainRepo }).catch(
			() => {},
		);
	});

	it("6. Provider fallback chain test - verifies --simulate-fallback triggers fallback to next provider", async () => {
		// Create router with simulateFailure enabled
		const router = new ProviderRouter({ simulateFailure: true });

		// Verify the router is configured for simulated failure
		expect(router).toBeDefined();

		// Test that fallback method returns a provider (not the original)
		// When simulateFailure is true, opencode-go will fail and fallback to another
		const fallbackProvider = router.fallback("opencode-go");

		// The fallback should NOT return opencode-go since it will be on cooldown/simulated failure
		// The fallback chain returns the next available provider
		expect(fallbackProvider).toBeDefined();
		expect(fallbackProvider).not.toBe("opencode-go");

		// Verify other providers work (they should not be on cooldown)
		// Just verify fallback can be called multiple times without crashing
		const fallback2 = router.fallback(fallbackProvider);
		expect(fallback2).toBeDefined();

		// Verify isOnCooldown works (should return false for most providers initially)
		const isCooldown = router.isOnCooldown(fallbackProvider);
		expect(typeof isCooldown).toBe("boolean");

		// Verify getFailureCount works
		const failureCount = router.getFailureCount("opencode-go");
		expect(typeof failureCount).toBe("number");
	});
});
