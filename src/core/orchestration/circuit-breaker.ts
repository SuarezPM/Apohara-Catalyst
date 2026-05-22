/**
 * Circuit breaker per spec §3.6.
 *
 * If a task has >= CIRCUIT_BREAKER_THRESHOLD consecutive failures since the
 * last success (or since creation), break the circuit. Prevents infinite retry.
 */
import type { OrchestrationDb } from "./db";
import { countRecentFailedDispatches } from "./dispatch-contexts";

export const CIRCUIT_BREAKER_THRESHOLD = 3;

export function shouldBreakCircuit(db: OrchestrationDb, taskId: string): boolean {
  return countRecentFailedDispatches(db, taskId) >= CIRCUIT_BREAKER_THRESHOLD;
}