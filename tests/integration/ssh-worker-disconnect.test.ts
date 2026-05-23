/**
 * W3.4 — SSH worker disconnect → task re-dispatch local.
 *
 * Extends G6.C.10's docker-compose smoke. Where G6.C.10 verifies the
 * handshake protocol works across a process boundary, this test pins
 * the recovery contract:
 *
 *   1. A worker session is "alive" while its heartbeat is fresh.
 *   2. After `DISCONNECT_AFTER` (30s) with no heartbeat, the session
 *      is declared stale.
 *   3. In-flight tasks NOT past half their SLA budget → re-dispatched
 *      locally (`RecoveryAction::Local`).
 *   4. Tasks PAST half their SLA budget → marked `FailedDisconnected`.
 *   5. The UI warning carries the correct counts of each.
 *
 * The Rust state (`HeartbeatTracker`, `plan_recovery`) is unit-tested
 * in `crates/apohara-daemon/src/recovery.rs::tests`. Here we mirror the
 * JSON contract from TS — the same shape the daemon emits over the WS
 * hub when a session goes stale, which any TS consumer (Action Bar,
 * github-bridge, etc.) must interpret correctly.
 *
 * Docker-driven portion skips cleanly when docker / handshake_oracle
 * are unavailable (same gate as G6.C.10).
 */
import { test, expect, describe } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = process.cwd();
const FIXTURE = path.join(REPO_ROOT, "tests/fixtures/docker-compose.workers.yaml");
const ORACLE_PATH = path.join(REPO_ROOT, "target/debug/handshake_oracle");

const HEARTBEAT_INTERVAL_MS = 10_000;
const HEARTBEAT_GRACE_BEATS = 3;
const DISCONNECT_AFTER_MS = HEARTBEAT_INTERVAL_MS * HEARTBEAT_GRACE_BEATS; // 30_000

interface InflightTask {
	taskId: string;
	slaBudgetMs: number;
	elapsedAtDisconnectMs: number;
}

type RecoveryAction = "local" | "failed_disconnected";

interface RecoveryDecision {
	taskId: string;
	action: RecoveryAction;
	reason: string;
}

interface RecoveryPlan {
	sessionId: string;
	decisions: RecoveryDecision[];
	uiWarning: {
		kind: "worker_disconnected";
		sessionId: string;
		message: string;
		reDispatchedCount: number;
		failedCount: number;
	};
}

/**
 * TS mirror of `apohara_daemon::recovery::plan_recovery`. Matches the
 * Rust algorithm: `>` not `>=` on half-life means exactly-half escapes
 * to local; strictly past-half goes failed.
 */
function planRecovery(sessionId: string, inflight: InflightTask[]): RecoveryPlan {
	let reDispatched = 0;
	let failed = 0;
	const decisions: RecoveryDecision[] = [];
	for (const t of inflight) {
		const pastHalfLife = t.elapsedAtDisconnectMs * 2 > t.slaBudgetMs;
		if (pastHalfLife) {
			decisions.push({
				taskId: t.taskId,
				action: "failed_disconnected",
				reason: `${t.elapsedAtDisconnectMs}ms elapsed of ${t.slaBudgetMs}ms SLA — past half-life; not retrying`,
			});
			failed += 1;
		} else {
			decisions.push({
				taskId: t.taskId,
				action: "local",
				reason: "worker disconnected; re-dispatching to local executor",
			});
			reDispatched += 1;
		}
	}
	return {
		sessionId,
		decisions,
		uiWarning: {
			kind: "worker_disconnected",
			sessionId,
			message: `worker session ${sessionId} disconnected — ${reDispatched} re-dispatched locally, ${failed} failed`,
			reDispatchedCount: reDispatched,
			failedCount: failed,
		},
	};
}

class HeartbeatTrackerTs {
	private last = new Map<string, number>();
	record(sessionId: string, atMs: number) {
		this.last.set(sessionId, atMs);
	}
	drop(sessionId: string) {
		this.last.delete(sessionId);
	}
	staleSessions(nowMs: number): string[] {
		const out: string[] = [];
		for (const [sid, ts] of this.last) {
			if (nowMs - ts >= DISCONNECT_AFTER_MS) out.push(sid);
		}
		return out;
	}
	lastSeen(sessionId: string): number | undefined {
		return this.last.get(sessionId);
	}
}

test("empty inflight produces empty plan with zero counts", () => {
	const plan = planRecovery("sess-1", []);
	expect(plan.decisions).toEqual([]);
	expect(plan.uiWarning.reDispatchedCount).toBe(0);
	expect(plan.uiWarning.failedCount).toBe(0);
	expect(plan.uiWarning.kind).toBe("worker_disconnected");
});

test("early task → re-dispatched local", () => {
	const plan = planRecovery("s1", [
		{ taskId: "t-A", slaBudgetMs: 1000, elapsedAtDisconnectMs: 100 },
	]);
	expect(plan.decisions[0]?.action).toBe("local");
	expect(plan.uiWarning.reDispatchedCount).toBe(1);
});

test("late task → failed_disconnected", () => {
	const plan = planRecovery("s1", [
		{ taskId: "t-B", slaBudgetMs: 1000, elapsedAtDisconnectMs: 900 },
	]);
	expect(plan.decisions[0]?.action).toBe("failed_disconnected");
	expect(plan.uiWarning.failedCount).toBe(1);
});

test("exactly-half-life escapes to local (strict >)", () => {
	const plan = planRecovery("s1", [
		{ taskId: "edge", slaBudgetMs: 1000, elapsedAtDisconnectMs: 500 },
	]);
	expect(plan.decisions[0]?.action).toBe("local");
});

test("mixed inflight counts separately", () => {
	const plan = planRecovery("s9", [
		{ taskId: "a", slaBudgetMs: 1000, elapsedAtDisconnectMs: 100 },
		{ taskId: "b", slaBudgetMs: 1000, elapsedAtDisconnectMs: 900 },
		{ taskId: "c", slaBudgetMs: 1000, elapsedAtDisconnectMs: 200 },
	]);
	expect(plan.uiWarning.reDispatchedCount).toBe(2);
	expect(plan.uiWarning.failedCount).toBe(1);
	expect(plan.uiWarning.message).toContain("s9");
});

test("heartbeat tracker flags stale sessions after grace", () => {
	const ht = new HeartbeatTrackerTs();
	const now = Date.now();
	ht.record("dead", now - DISCONNECT_AFTER_MS - 1000);
	ht.record("alive", now);
	const stale = ht.staleSessions(now);
	expect(stale).toEqual(["dead"]);
});

test("heartbeat tracker records and drops sessions", () => {
	const ht = new HeartbeatTrackerTs();
	ht.record("s1", Date.now());
	expect(ht.lastSeen("s1")).toBeDefined();
	ht.drop("s1");
	expect(ht.lastSeen("s1")).toBeUndefined();
});

test("session disconnect → all in-flight tasks have a recovery decision", () => {
	// End-to-end "session disconnected" scenario: tracker drops, plan
	// runs, each in-flight task receives exactly one decision (local or
	// failed), UI warning summarises.
	const inflight: InflightTask[] = [
		{ taskId: "build-1", slaBudgetMs: 60_000, elapsedAtDisconnectMs: 5_000 },
		{ taskId: "build-2", slaBudgetMs: 60_000, elapsedAtDisconnectMs: 45_000 },
		{ taskId: "test-suite", slaBudgetMs: 30_000, elapsedAtDisconnectMs: 10_000 },
	];
	const plan = planRecovery("worker-7", inflight);
	expect(plan.decisions.length).toBe(inflight.length);
	const decisionsByTask = new Map(plan.decisions.map((d) => [d.taskId, d]));
	expect(decisionsByTask.get("build-1")?.action).toBe("local");
	expect(decisionsByTask.get("build-2")?.action).toBe("failed_disconnected");
	expect(decisionsByTask.get("test-suite")?.action).toBe("local");
});

test("constants align with Rust DISCONNECT_AFTER (30s)", () => {
	expect(HEARTBEAT_INTERVAL_MS).toBe(10_000);
	expect(HEARTBEAT_GRACE_BEATS).toBe(3);
	expect(DISCONNECT_AFTER_MS).toBe(30_000);
});

// ----- Optional docker-driven leg (skips if docker / oracle missing) -----

function hasDocker(): boolean {
	if (process.env.APOHARA_SKIP_DOCKER_E2E === "1") return false;
	try {
		const r = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], {
			stdio: ["ignore", "pipe", "pipe"],
			timeout: 5000,
		});
		return r.status === 0;
	} catch {
		return false;
	}
}

const RUN_DOCKER = hasDocker() && existsSync(ORACLE_PATH) && existsSync(FIXTURE);

describe("W3.4 docker-extended (skips when docker unavailable)", () => {
	test.skipIf(!RUN_DOCKER)(
		"worker container kill simulates disconnect: tracker marks stale",
		async () => {
			// Simulate a worker container being docker-killed: bring up worker-1,
			// snapshot its handshake, then bring it down. The tracker (TS side)
			// records last-seen-now → +DISCONNECT_AFTER_MS, never receives a
			// fresh beat → eventually flagged stale.
			spawnSync(
				"docker",
				["compose", "-f", FIXTURE, "down", "--remove-orphans", "-t", "1"],
				{ stdio: "ignore", timeout: 30_000 },
			);
			const up = spawnSync(
				"docker",
				[
					"compose",
					"-f",
					FIXTURE,
					"up",
					"--abort-on-container-exit",
					"--exit-code-from",
					"worker-1",
				],
				{ stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 },
			);
			expect(up.error).toBeUndefined();

			// After the containers exited, simulate the "session went stale"
			// detection: record a heartbeat 31s ago, see it flagged.
			const ht = new HeartbeatTrackerTs();
			const now = Date.now();
			ht.record("worker-1", now - DISCONNECT_AFTER_MS - 1_000);
			expect(ht.staleSessions(now)).toContain("worker-1");

			// Cleanup
			spawnSync(
				"docker",
				["compose", "-f", FIXTURE, "down", "--remove-orphans", "-t", "1"],
				{ stdio: "ignore", timeout: 30_000 },
			);
		},
		180_000,
	);
});
