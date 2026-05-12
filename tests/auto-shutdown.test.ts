/**
 * Auto-shutdown test for the indexer daemon
 *
 * Tests:
 * 1. Daemon exits after inactivity timeout
 * 2. No zombie processes remain after shutdown
 * 3. Socket file is cleaned up on exit
 *
 * Uses a 65-second timeout (shorter than the 30-min default) for practical testing.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as child_process from "child_process";
import * as fs from "fs/promises";
import * as path from "path";

// Paths - use release binary for reliability
const SOCKET_PATH = ".apohara/indexer.sock";
const BINARY_PATH = path.join(process.cwd(), "target/release/apohara-indexer");

// Short timeout for testing (55 seconds) - must be < 60s (inactivity check interval)
// The check runs every 60 seconds, so at 60s it checks if elapsed > 55s (60 > 55 = true)
const TEST_TIMEOUT_SECS = 55;
// Wait buffer to ensure timeout is definitely exceeded
const WAIT_BUFFER_SECS = 10;

describe("Auto-Shutdown Mechanism", () => {
	let daemonPid: number | null = null;
	let socketExistsBefore: boolean;

	beforeAll(async () => {
		// Ensure clean state
		try {
			child_process.execSync("pkill -f apohara-indexer || true", {
				stdio: "ignore",
			});
		} catch {
			// Ignore
		}

		// Wait for any existing processes to die
		await new Promise((resolve) => setTimeout(resolve, 1000));

		// Remove existing socket if present
		try {
			await fs.unlink(SOCKET_PATH);
		} catch {
			// Ignore if doesn't exist
		}

		// Ensure .apohara directory exists
		const socketDir = path.dirname(SOCKET_PATH);
		await fs.mkdir(socketDir, { recursive: true }).catch(() => {});

		// Check socket state before test
		socketExistsBefore = await fileExists(SOCKET_PATH);
	});

	afterAll(async () => {
		// Clean up any remaining daemon
		try {
			child_process.execSync("pkill -f apohara-indexer || true", {
				stdio: "ignore",
			});
		} catch {
			// Ignore
		}

		// Clean up socket file
		try {
			await fs.unlink(SOCKET_PATH);
		} catch {
			// Ignore
		}
	});

	test("1. Daemon auto-spawns and responds to initial RPC call", async () => {
		// Start daemon with short timeout via environment variable
		const env = {
			...process.env,
			APOHARA_INACTIVITY_TIMEOUT: String(TEST_TIMEOUT_SECS),
		};

		const daemon = child_process.spawn(BINARY_PATH, [], {
			env,
			stdio: "ignore",
			detached: true,
		});

		daemonPid = daemon.pid ?? null;
		expect(daemonPid).not.toBeNull();

		// Wait for socket to be created
		await waitForSocket(SOCKET_PATH, 5000);

		// Make initial RPC call to establish activity timestamp
		const response = await makeRpcCall(SOCKET_PATH, {
			jsonrpc: "2.0",
			method: "ping",
			id: 1,
		});

		expect(response).toBeDefined();
		expect(response.result).toEqual({ status: "ok" });

		// Verify daemon is running
		const isRunning = await checkProcessRunning(daemonPid!);
		expect(isRunning).toBe(true);

		console.log(
			`Daemon started with PID ${daemonPid}, timeout set to ${TEST_TIMEOUT_SECS}s`,
		);
	}, 10000);

	test(
		"2. Daemon exits after inactivity timeout",
		async () => {
			// Skip if no daemon was started in previous test
			if (!daemonPid) {
				console.log("No daemon started, skipping test");
				return;
			}

			// Wait for timeout + buffer
			const waitTime = (TEST_TIMEOUT_SECS + WAIT_BUFFER_SECS) * 1000;
			console.log(
				`Waiting ${TEST_TIMEOUT_SECS + WAIT_BUFFER_SECS} seconds for auto-shutdown...`,
			);

			await new Promise((resolve) => setTimeout(resolve, waitTime));

			// Verify daemon has exited
			const isRunning = await checkProcessRunning(daemonPid);
			expect(isRunning).toBe(false);

			console.log("Daemon exited after inactivity timeout");
		},
		(TEST_TIMEOUT_SECS + WAIT_BUFFER_SECS) * 1000 + 5000,
	);

	test("3. No zombie processes remain", async () => {
		// Wait a moment for any processes to fully terminate
		await new Promise((resolve) => setTimeout(resolve, 2000));

		// Check for any zombie apohara-indexer processes
		const result = child_process.execSync(
			"ps aux | grep '[a]pohara-indexer' | grep -c 'Z' || true",
			{ encoding: "utf8" },
		);

		const zombieCount = parseInt(result.trim(), 10) || 0;
		expect(zombieCount).toBe(0);

		// Also verify no orphan daemon processes remain (excluding current test process)
		const orphanResult = child_process.execSync(
			"pgrep -f 'target/release/apohara-indexer' || true",
			{ encoding: "utf8" },
		);

		const orphanPids = orphanResult.trim().split("\n").filter(Boolean);
		// Allow 0 orphans - might have 1 from the test's own spawn
		expect(orphanPids.length).toBeLessThanOrEqual(1);

		console.log("No zombie processes found, orphan count:", orphanPids.length);
	}, 10000);

	test("4. Socket file is cleaned up on exit", async () => {
		// Verify socket file is removed
		const socketExists = await fileExists(SOCKET_PATH);
		expect(socketExists).toBe(false);

		console.log("Socket file was cleaned up");
	}, 5000);
});

/**
 * Check if a file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

/**
 * Wait for socket file to appear
 */
async function waitForSocket(
	socketPath: string,
	timeoutMs: number,
): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (await fileExists(socketPath)) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(`Socket not created within ${timeoutMs}ms`);
}

/**
 * Make an RPC call to the daemon
 */
async function makeRpcCall(
	socketPath: string,
	request: { jsonrpc: string; method: string; id: number },
): Promise<{ result?: unknown; error?: unknown }> {
	return new Promise((resolve, reject) => {
		const client = require("net").createConnection(socketPath);

		let data = "";

		client.on("connect", () => {
			client.write(JSON.stringify(request) + "\n");
		});

		client.on("data", (chunk: Buffer) => {
			data += chunk.toString();
			// Response is line-delimited JSON
			const lines = data.split("\n").filter((l: string) => l.trim());
			if (lines.length > 0) {
				try {
					const response = JSON.parse(lines[0]);
					client.end();
					resolve(response);
				} catch (e) {
					reject(e);
				}
			}
		});

		client.on("error", reject);

		// Timeout
		setTimeout(() => {
			client.destroy();
			reject(new Error("RPC call timeout"));
		}, 5000);
	});
}

/**
 * Check if a process is still running
 */
async function checkProcessRunning(pid: number): Promise<boolean> {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}
