/**
 * Tests for M014.5 (security_violation ledger events) and M014.6
 * (non-Linux fallback with explicit consent).
 *
 * Test platform forcing: `APOHARA_FORCE_NONLINUX=1` makes Isolator.exec
 * take the bypass path even on Linux. With this set + `APOHARA_ALLOW_UNSANDBOXED=1`,
 * exec runs the command directly via spawn. Without consent, exec returns
 * a sandbox_unavailable error.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Isolator } from "../src/core/sandbox";
import type { EventLog } from "../src/core/types";

async function ledgerEvents(filePath: string): Promise<EventLog[]> {
	const text = await readFile(filePath, "utf-8");
	return text
		.split("\n")
		.filter((l) => l.length > 0)
		.map((l) => JSON.parse(l) as EventLog);
}

describe("Isolator — M014.6 non-Linux fallback", () => {
	let dir: string;
	const originalForce = process.env.APOHARA_FORCE_NONLINUX;
	const originalConsent = process.env.APOHARA_ALLOW_UNSANDBOXED;
	const originalCwd = process.cwd();

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "apohara-sandbox-test-"));
		// Force the sandbox.ts ledger to write into our tmp dir.
		process.chdir(dir);
	});

	afterEach(async () => {
		process.chdir(originalCwd);
		if (originalForce === undefined) {
			delete process.env.APOHARA_FORCE_NONLINUX;
		} else {
			process.env.APOHARA_FORCE_NONLINUX = originalForce;
		}
		if (originalConsent === undefined) {
			delete process.env.APOHARA_ALLOW_UNSANDBOXED;
		} else {
			process.env.APOHARA_ALLOW_UNSANDBOXED = originalConsent;
		}
		await rm(dir, { recursive: true, force: true });
	});

	it("without explicit consent: returns sandbox_unavailable error", async () => {
		process.env.APOHARA_FORCE_NONLINUX = "1";
		delete process.env.APOHARA_ALLOW_UNSANDBOXED;

		const isolator = new Isolator();
		const result = await isolator.exec({
			workdir: dir,
			command: "echo blocked",
			permission: "workspace_write",
		});

		expect(result.exitCode).toBe(99);
		expect(result.error).toBe("sandbox_unavailable");
		expect(result.violations).toContain("sandbox_unavailable_no_consent");
		expect(result.stderr).toContain("APOHARA_ALLOW_UNSANDBOXED");
	});

	it("with consent: runs command directly + emits sandbox_bypassed event", async () => {
		process.env.APOHARA_FORCE_NONLINUX = "1";
		process.env.APOHARA_ALLOW_UNSANDBOXED = "1";

		const isolator = new Isolator();
		const result = await isolator.exec({
			workdir: dir,
			command: "/bin/sh -c true",
			permission: "workspace_write",
			taskId: "t-fallback",
		});

		expect(result.exitCode).toBe(0);
		expect(result.error).toBeUndefined();
		expect(result.violations).toEqual([]);

		const events = await ledgerEvents(isolator.getEventLedgerPath());
		const bypassed = events.find((e) => e.type === "sandbox_bypassed");
		expect(bypassed).toBeDefined();
		expect(bypassed?.payload.reason).toBe("non_linux_with_explicit_consent");
		expect(bypassed?.payload.platform).toBeDefined();
		expect(bypassed?.taskId).toBe("t-fallback");

		// The rollup sandbox_execution event must also be present.
		const rollup = events.find((e) => e.type === "sandbox_execution");
		expect(rollup).toBeDefined();
		expect(rollup?.payload.exitCode).toBe(0);
	});
});

describe("Isolator — M014.5 security_violation events", () => {
	let dir: string;
	const originalForce = process.env.APOHARA_FORCE_NONLINUX;
	const originalConsent = process.env.APOHARA_ALLOW_UNSANDBOXED;
	const originalCwd = process.cwd();

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "apohara-sandbox-test-"));
		process.chdir(dir);
	});

	afterEach(async () => {
		process.chdir(originalCwd);
		if (originalForce === undefined) {
			delete process.env.APOHARA_FORCE_NONLINUX;
		} else {
			process.env.APOHARA_FORCE_NONLINUX = originalForce;
		}
		if (originalConsent === undefined) {
			delete process.env.APOHARA_ALLOW_UNSANDBOXED;
		} else {
			process.env.APOHARA_ALLOW_UNSANDBOXED = originalConsent;
		}
		await rm(dir, { recursive: true, force: true });
	});

	it("a no-consent fallback emits a security_violation per violation", async () => {
		process.env.APOHARA_FORCE_NONLINUX = "1";
		delete process.env.APOHARA_ALLOW_UNSANDBOXED;

		const isolator = new Isolator();
		await isolator.exec({
			workdir: dir,
			command: "echo blocked",
			permission: "readonly",
			taskId: "t-violation",
		});

		const events = await ledgerEvents(isolator.getEventLedgerPath());
		const violations = events.filter((e) => e.type === "security_violation");
		expect(violations.length).toBe(1);
		expect(violations[0].payload.syscall).toBe(
			"sandbox_unavailable_no_consent",
		);
		expect(violations[0].payload.permission).toBe("readonly");
		expect(violations[0].taskId).toBe("t-violation");
		expect(violations[0].severity).toBe("warning");
	});
});
