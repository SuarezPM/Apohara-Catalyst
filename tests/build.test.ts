import { describe, expect, it } from "bun:test";
import { exec as execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(execSync);

// Read version from package.json so the assertion stays in sync with the
// real shipped artifact instead of a hardcoded literal.
const pkg = JSON.parse(
	fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"),
) as { version: string };

describe("Build Distribution", () => {
	const distPath = path.resolve(process.cwd(), "dist/cli.js");

	it("should produce dist/cli.js", () => {
		expect(fs.existsSync(distPath)).toBe(true);
	});

	it("should run under node and show help", async () => {
		const { stdout } = await execAsync("node dist/cli.js --help");
		expect(stdout).toContain("Apohara CLI");
		expect(stdout).toContain("config");
		expect(stdout).toContain("auto");
		expect(stdout).toContain("dashboard");
	});

	it("should show correct version under node", async () => {
		const { stdout } = await execAsync("node dist/cli.js --version");
		expect(stdout).toContain(pkg.version);
	});
});
