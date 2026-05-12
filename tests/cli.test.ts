import { exec as execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execAsync = promisify(execSync);

// Test imports that interact with the file system
import { configCommand } from "../src/commands/config.js";

describe("CLI Router", () => {
	it("should parse arguments and show help", async () => {
		const { stdout } = await execAsync("bun run src/cli.ts --help");
		expect(stdout).toContain("Apohara CLI");
		expect(stdout).toContain("config");
	});

	it("should show version", async () => {
		const { stdout } = await execAsync("bun run src/cli.ts --version");
		expect(stdout).toContain("0.1.0");
	});
});

describe("config command - integration", () => {
	const testDir = path.resolve(process.cwd(), ".test-temp");
	let consoleLogSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(async () => {
		// Create temp directory
		await fs.mkdir(testDir, { recursive: true }).catch(() => {});
		consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
	});

	afterEach(async () => {
		vi.resetAllMocks();
		// Clean up temp directory
		await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
	});

	it("should create .env file if it does not exist", async () => {
		const testEnvPath = path.resolve(testDir, ".env");
		// Ensure file doesn't exist
		await fs.unlink(testEnvPath).catch(() => {});

		// Direct test - import the module and call the action directly
		// Since the command uses process.cwd(), we need a different test approach
		// Let's test the actual CLI from the test directory
		const originalCwd = process.cwd();

		try {
			process.chdir(testDir);

			// Run CLI directly from the test directory
			const { stdout } = await execAsync("bun run ../src/cli.ts config", {
				cwd: testDir,
			});

			const fileContent = await fs.readFile(testEnvPath, "utf-8");
			expect(fileContent).toContain("OPENCODE_API_KEY=");
			expect(fileContent).toContain("DEEPSEEK_API_KEY=");
			expect(fileContent).toContain("NODE_ENV=development");
			expect(stdout).toContain("✅ Created .env file successfully.");
		} finally {
			process.chdir(originalCwd);
		}
	});

	it("should not create .env file if it already exists", async () => {
		const testEnvPath = path.resolve(testDir, ".env");
		// Create file first
		await fs.writeFile(testEnvPath, "EXISTING=value\n", "utf-8");

		const originalCwd = process.cwd();

		try {
			process.chdir(testDir);

			const { stdout } = await execAsync("bun run ../src/cli.ts config", {
				cwd: testDir,
			});

			const fileContent = await fs.readFile(testEnvPath, "utf-8");
			expect(fileContent).toBe("EXISTING=value\n");
			expect(stdout).toContain("ℹ️ .env file already exists.");
		} finally {
			process.chdir(originalCwd);
		}
	});
});
