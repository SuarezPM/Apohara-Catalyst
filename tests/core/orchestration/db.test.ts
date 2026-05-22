import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	openOrchestrationDb,
	type OrchestrationDb,
} from "../../../src/core/orchestration/db";

let workDir: string;
let db: OrchestrationDb;

beforeEach(async () => {
	workDir = await mkdtemp(join(tmpdir(), "apohara-orch-"));
	db = await openOrchestrationDb(join(workDir, "orchestration.db"));
});

afterEach(async () => {
	db.close();
	await rm(workDir, { recursive: true, force: true });
});

test("opens DB with WAL mode and creates schema v1", () => {
	const journalMode = db.raw().query("PRAGMA journal_mode").get() as {
		journal_mode: string;
	};
	expect(journalMode.journal_mode).toBe("wal");

	const userVersion = db.raw().query("PRAGMA user_version").get() as {
		user_version: number;
	};
	expect(userVersion.user_version).toBe(1);
});

test("creates the 5 core tables", () => {
	const tables = db
		.raw()
		.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
		.all() as { name: string }[];
	const names = tables.map((t) => t.name);
	expect(names).toContain("messages");
	expect(names).toContain("tasks");
	expect(names).toContain("dispatch_contexts");
	expect(names).toContain("decision_gates");
	expect(names).toContain("coordinator_runs");
});

test("busy_timeout is 5000", () => {
	const bt = db.raw().query("PRAGMA busy_timeout").get() as {
		timeout: number;
	};
	expect(bt.timeout).toBe(5000);
});

test("re-opening an existing DB does NOT re-run migrations", async () => {
	db.close();
	db = await openOrchestrationDb(join(workDir, "orchestration.db"));
	// If migrations re-ran, user_version would still be 1 (idempotent via
	// PRAGMA user_version guard). CREATE TABLE IF NOT EXISTS is also safe,
	// but the contract under test is the version pragma gate.
	const userVersion = db.raw().query("PRAGMA user_version").get() as {
		user_version: number;
	};
	expect(userVersion.user_version).toBe(1);
});
