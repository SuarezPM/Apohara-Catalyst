/**
 * coordinator_runs table CRUD per spec §3.6.
 *
 * One row per coordinator process lifecycle. `id` is the durable
 * coordinator-run identifier; `run_id` is the operator-visible run
 * tag (often = orchestration run from `apohara run --tag`). Terminal
 * statuses (`completed`, `aborted`) stamp `ended_at`; intermediate
 * transitions leave it NULL so a crash mid-run is visible.
 */
import type { OrchestrationDb } from "./db";

export type RunStatus = "starting" | "running" | "completed" | "aborted";

const TERMINAL_STATUSES: RunStatus[] = ["completed", "aborted"];
const VALID_STATUSES: RunStatus[] = [
	"starting",
	"running",
	"completed",
	"aborted",
];

export function startRun(db: OrchestrationDb, id: string, runId: string): void {
	db.raw()
		.prepare(`
			INSERT INTO coordinator_runs (id, run_id, status, started_at)
			VALUES (?, ?, 'starting', ?)
		`)
		.run(id, runId, Date.now());
}

export function setRunStatus(
	db: OrchestrationDb,
	id: string,
	status: RunStatus,
): void {
	if (!VALID_STATUSES.includes(status)) {
		throw new Error(`invalid run status: ${status}`);
	}
	const endedAt = TERMINAL_STATUSES.includes(status) ? Date.now() : null;
	db.raw()
		.prepare(
			`UPDATE coordinator_runs SET status = ?, ended_at = ? WHERE id = ?`,
		)
		.run(status, endedAt, id);
}
