import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initOrchestrationDb, type OrchestrationDb } from "../../../src/core/orchestration/db";
import {
	enrollSetupVerificationTask,
	inspectSetupVerification,
	SETUP_TASK_ID,
} from "../../../src/core/orchestration/setup-verification";
import { updateTaskStatus } from "../../../src/core/orchestration/tasks";

const MIGRATION_SQL = readFileSync(
	join(import.meta.dir, "../../../src/core/orchestration/migrations/001_initial.sql"),
	"utf-8",
);

let db: OrchestrationDb;

function freshDb(): OrchestrationDb {
	const raw = new Database(":memory:");
	raw.exec(MIGRATION_SQL);
	return initOrchestrationDb(raw);
}

beforeEach(() => {
	db = freshDb();
});

test("enrolls LOCAL-SETUP-001 with all three providers", () => {
	const row = enrollSetupVerificationTask(db, {
		enabledProviders: ["claude-code-cli", "codex-cli", "opencode-go"],
	});
	expect(row.id).toBe(SETUP_TASK_ID);
	expect(row.status).toBe("pending");
	expect(row.description).toContain("apohara-ok-claude-code-cli");
	expect(row.description).toContain("apohara-ok-codex-cli");
	expect(row.description).toContain("apohara-ok-opencode-go");
});

test("idempotent — second enroll returns existing row, no duplicate insert", () => {
	enrollSetupVerificationTask(db, { enabledProviders: ["claude-code-cli"] });
	enrollSetupVerificationTask(db, {
		enabledProviders: ["claude-code-cli", "codex-cli"],
	});
	const count = (
		db.raw().query("SELECT COUNT(*) as n FROM tasks WHERE id = ?").get(SETUP_TASK_ID) as {
			n: number;
		}
	).n;
	expect(count).toBe(1);
});

test("description lists providers in sorted order (deterministic)", () => {
	const row = enrollSetupVerificationTask(db, {
		enabledProviders: ["opencode-go", "claude-code-cli", "codex-cli"],
	});
	const idxClaude = row.description.indexOf("apohara-ok-claude-code-cli");
	const idxCodex = row.description.indexOf("apohara-ok-codex-cli");
	const idxOpen = row.description.indexOf("apohara-ok-opencode-go");
	expect(idxClaude).toBeGreaterThan(0);
	expect(idxClaude).toBeLessThan(idxCodex);
	expect(idxCodex).toBeLessThan(idxOpen);
});

test("inspectSetupVerification returns missing when not enrolled", () => {
	const r = inspectSetupVerification(db);
	expect(r.ok).toBe(false);
	expect(r.taskStatus).toBe("missing");
});

test("inspectSetupVerification returns pending after enroll, not yet verified", () => {
	enrollSetupVerificationTask(db, { enabledProviders: ["claude-code-cli"] });
	const r = inspectSetupVerification(db);
	expect(r.ok).toBe(false);
	expect(r.taskStatus).toBe("pending");
});

test("inspectSetupVerification returns ok after completion with Approved verdict + ledger_root", () => {
	enrollSetupVerificationTask(db, { enabledProviders: ["claude-code-cli"] });
	updateTaskStatus(db, SETUP_TASK_ID, "completed", {
		verdict: "Approved",
		ledger_root: "sha256:abc123",
	});
	const r = inspectSetupVerification(db);
	expect(r.ok).toBe(true);
	expect(r.ledgerRoot).toBe("sha256:abc123");
	expect(r.message).toBe("verified");
});

test("inspectSetupVerification stays not-ok if completed but verdict != Approved", () => {
	enrollSetupVerificationTask(db, { enabledProviders: ["claude-code-cli"] });
	updateTaskStatus(db, SETUP_TASK_ID, "completed", {
		verdict: "Rejected",
		ledger_root: "sha256:def",
	});
	const r = inspectSetupVerification(db);
	expect(r.ok).toBe(false);
	expect(r.ledgerRoot).toBe("sha256:def");
});

test("marks task with @apohara-setup terminal handle (low-priority lane marker)", () => {
	enrollSetupVerificationTask(db, { enabledProviders: ["claude-code-cli"] });
	const row = db
		.raw()
		.query("SELECT created_by_terminal_handle FROM tasks WHERE id = ?")
		.get(SETUP_TASK_ID) as
		| { created_by_terminal_handle: string }
		| undefined;
	expect(row?.created_by_terminal_handle).toBe("@apohara-setup");
});