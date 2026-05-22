/**
 * Drift detection per spec §3.6.
 */
import { spawn } from "bun";

export const DISPATCH_STALE_THRESHOLD = 20;

export interface DriftReport {
  commitsBehind: number;
  recentSubjects: string[];
}

export async function probeWorktreeDrift(worktreePath: string, baseRef: string): Promise<DriftReport> {
  try {
    await spawn(["git", "-C", worktreePath, "fetch", "origin", baseRef], { stdout: "pipe", stderr: "pipe" }).exited;
  } catch { /* swallow */ }

  const revParse = spawn(["git", "-C", worktreePath, "rev-parse", `origin/${baseRef}`], { stdout: "pipe", stderr: "pipe" });
  const revExit = await revParse.exited;
  if (revExit !== 0) {
    return { commitsBehind: 0, recentSubjects: [] };
  }

  const countProc = spawn(["git", "-C", worktreePath, "rev-list", "--count", `HEAD..origin/${baseRef}`], { stdout: "pipe", stderr: "pipe" });
  const countOut = await new Response(countProc.stdout).text();
  const commitsBehind = parseInt(countOut.trim(), 10) || 0;

  const subjectsProc = spawn(["git", "-C", worktreePath, "log", "--pretty=%s", "-5", `HEAD..origin/${baseRef}`], { stdout: "pipe", stderr: "pipe" });
  const subjectsOut = await new Response(subjectsProc.stdout).text();
  const recentSubjects = subjectsOut.split("\n").map(s => s.trim()).filter(Boolean);

  return { commitsBehind, recentSubjects };
}

export interface DispatchSpecLike {
  allowStaleBase?: boolean;
}

export function shouldRefuseDispatch(drift: DriftReport, spec: DispatchSpecLike): boolean {
  if (drift.commitsBehind < DISPATCH_STALE_THRESHOLD) return false;
  if (spec.allowStaleBase === true) return false;
  return true;
}