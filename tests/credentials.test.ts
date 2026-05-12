import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	resolveCredential,
	resolveCredentialSync,
} from "../src/core/credentials";

describe("credentials", () => {
	const testDir = path.join(
		os.tmpdir(),
		"apohara-test-credentials-" + Date.now(),
	);
	const originalXdgConfig = process.env.XDG_CONFIG_HOME;
	const originalOpencodeKey = process.env.OPENCODE_API_KEY;
	const originalHome = process.env.HOME;

	beforeEach(async () => {
		process.env.XDG_CONFIG_HOME = testDir;
		process.env.HOME = testDir;
		delete process.env.OPENCODE_GO_API_KEY;
		delete process.env.OPENCODE_API_KEY;
		await fs.mkdir(testDir, { recursive: true });
	});

	afterEach(async () => {
		process.env.XDG_CONFIG_HOME = originalXdgConfig;
		process.env.HOME = originalHome;
		process.env.OPENCODE_API_KEY = originalOpencodeKey;
		try {
			await fs.rm(testDir, { recursive: true, force: true });
		} catch {
			// ignore
		}
	});

	it("reads credential from credentials.json file", async () => {
		const apoharaDir = path.join(testDir, "apohara");
		await fs.mkdir(apoharaDir, { recursive: true });
		const credPath = path.join(apoharaDir, "credentials.json");
		await fs.writeFile(
			credPath,
			JSON.stringify({ "opencode-go": { apiKey: "file-key-123" } }),
			"utf-8",
		);

		const result = await resolveCredential("opencode-go");
		expect(result).toBe("file-key-123");
	});

	it("falls back to environment variable when file missing", async () => {
		process.env.OPENCODE_GO_API_KEY = "env-key-456";

		const result = await resolveCredential("opencode-go");
		expect(result).toBe("env-key-456");
	});

	it("returns anonymous for free-tier providers without auth", async () => {
		const result = await resolveCredential("kiro-ai");
		expect(result).toBe("anonymous");
	});

	it("returns null when no credentials found", async () => {
		const result = await resolveCredential("opencode-go");
		expect(result).toBeNull();
	});

	it("resolveCredentialSync checks env vars and free-tier", () => {
		process.env.DEEPSEEK_API_KEY = "sync-key-789";
		expect(resolveCredentialSync("deepseek")).toBe("sync-key-789");
		expect(resolveCredentialSync("iflow-ai")).toBe("anonymous");
		expect(resolveCredentialSync("unknown-provider")).toBeNull();
	});
});
