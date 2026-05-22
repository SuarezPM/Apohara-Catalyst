/**
 * Circuit breaker per spec §3.6.
 *
 * If a task has >= CIRCUIT_BREAKER_THRESHOLD consecutive failures since the
 * last success (or since creation), break the circuit. Prevents infinite retry.
 *
 * The threshold is read from `APOHARA_CIRCUIT_BREAKER_THRESHOLD` once at
 * module load so a deployment can tighten / relax the gate without a
 * code change. Default `3` matches the spec.
 */
import type { OrchestrationDb } from "./db";
import { countRecentFailedDispatches } from "./dispatch-contexts";

function readThreshold(): number {
	const raw = process.env.APOHARA_CIRCUIT_BREAKER_THRESHOLD;
	if (!raw) return 3;
	const n = Number.parseInt(raw, 10);
	return Number.isFinite(n) && n >= 1 ? n : 3;
}

export const CIRCUIT_BREAKER_THRESHOLD = readThreshold();

export function shouldBreakCircuit(db: OrchestrationDb, taskId: string): boolean {
	return countRecentFailedDispatches(db, taskId) >= CIRCUIT_BREAKER_THRESHOLD;
}
