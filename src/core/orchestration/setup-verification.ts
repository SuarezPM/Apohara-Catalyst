/**
 * Spec §7.1: setup-verification task LOCAL-SETUP-001.
 *
 * Idempotent enrollment of a special task that asks each enabled provider to
 * echo `apohara-ok-{provider}` and the judge to approve. Returns the row from
 * the DB after insertion (or the existing row if already present).
 *
 * Lane semantics ("low-priority"): the spec calls for this task to only run
 * when no normal-runnable task is available. We mark it with
 * createdByTerminalHandle="@apohara-setup" so a future scheduler change can
 * filter on it. For v1.0 we rely on `ts` ordering — this task is enrolled at
 * install time, so newer normal tasks naturally outrank it.
 */
import type { OrchestrationDb } from "./db.js";
import { insertTask, type TaskInput } from "./tasks.js";

export const SETUP_TASK_ID = "LOCAL-SETUP-001";

export interface EnrollOpts {
	enabledProviders: string[];
}

export interface SetupTaskRow {
	id: string;
	status: string;
	description: string;
}

export function enrollSetupVerificationTask(
	db: OrchestrationDb,
	opts: EnrollOpts,
): SetupTaskRow {
	const existing = db
		.raw()
		.query("SELECT id, status, spec FROM tasks WHERE id = ?")
		.get(SETUP_TASK_ID) as
		| { id: string; status: string; spec: string }
		| undefined;
	if (existing) {
		const spec = JSON.parse(existing.spec) as { description: string };
		return { id: existing.id, status: existing.status, description: spec.description };
	}

	const provs = opts.enabledProviders.slice().sort();
	const echoList = provs.map(p => `apohara-ok-${p}`).join(", ");
	const description =
		`Setup verification: each enabled provider must echo its tag (${echoList}) ` +
		`to its session, judge must approve.`;

	const input: TaskInput = {
		id: SETUP_TASK_ID,
		spec: {
			description,
			agentRole: "coder",
			symbols: { reads: [], writes: [], renames: [] },
		},
		deps: [],
		createdByTerminalHandle: "@apohara-setup",
	};
	insertTask(db, input);
	return { id: SETUP_TASK_ID, status: "pending", description };
}

export interface VerifySetupResult {
	ok: boolean;
	taskStatus: string;
	ledgerRoot: string | null;
	message: string;
}

/**
 * Inspect current state of LOCAL-SETUP-001 — used by `apohara verify-setup`
 * CLI command. Does NOT poll/wait; just snapshots current state. Callers can
 * loop themselves.
 */
export function inspectSetupVerification(
	db: OrchestrationDb,
): VerifySetupResult {
	const row = db
		.raw()
		.query("SELECT status, result FROM tasks WHERE id = ?")
		.get(SETUP_TASK_ID) as
		| { status: string; result: string | null }
		| undefined;
	if (!row) {
		return {
			ok: false,
			taskStatus: "missing",
			ledgerRoot: null,
			message: "LOCAL-SETUP-001 not enrolled",
		};
	}
	const result =
		row.result
			? (JSON.parse(row.result) as { ledger_root?: string; verdict?: string })
			: null;
	const ledgerRoot = result?.ledger_root ?? null;
	if (row.status === "completed" && result?.verdict === "Approved") {
		return { ok: true, taskStatus: row.status, ledgerRoot, message: "verified" };
	}
	return {
		ok: false,
		taskStatus: row.status,
		ledgerRoot,
		message: `not yet verified (status=${row.status})`,
	};
}