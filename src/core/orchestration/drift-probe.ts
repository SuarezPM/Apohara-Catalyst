/**
 * Drift detection per spec §3.6.
 *
 * §0.4 — `git` is invoked through `Bun.spawn` and the parent env is NEVER
 * passed through unsanitized. Secrets in the runner env (CI tokens, API
 * keys, OAuth refresh tokens) would otherwise reach the git subprocess
 * and any credential helper / hook it triggers.
 */
import { spawn } from "bun";
import { sanitizeEnv } from "../persistence/envSanitizer";

function readThreshold(): number {
	const raw = process.env.APOHARA_DISPATCH_STALE_THRESHOLD;
	if (!raw) return 20;
	const n = Number.parseInt(raw, 10);
	return Number.isFinite(n) && n >= 1 ? n : 20;
}

/** Override at deploy time via APOHARA_DISPATCH_STALE_THRESHOLD. */
export const DISPATCH_STALE_THRESHOLD = readThreshold();

export interface DriftReport {
	commitsBehind: number;
	recentSubjects: string[];
}

function gitEnv(): Record<string, string> {
	return sanitizeEnv(process.env as Record<string, string | undefined>);
}

export async function probeWorktreeDrift(
	worktreePath: string,
	baseRef: string,
): Promise<DriftReport> {
	const env = gitEnv();
	try {
		const fetchProc = spawn(
			["git", "-C", worktreePath, "fetch", "origin", baseRef],
			{ stdout: "pipe", stderr: "pipe", env },
		);
		// Always await `.exited` so the subprocess is reaped even when
		// the fetch fails — otherwise long sessions accumulate zombies.
		await fetchProc.exited;
	} catch {
		/* swallow */
	}

	const revParse = spawn(
		["git", "-C", worktreePath, "rev-parse", `origin/${baseRef}`],
		{ stdout: "pipe", stderr: "pipe", env },
	);
	const revExit = await revParse.exited;
	if (revExit !== 0) {
		return { commitsBehind: 0, recentSubjects: [] };
	}

	const countProc = spawn(
		[
			"git",
			"-C",
			worktreePath,
			"rev-list",
			"--count",
			`HEAD..origin/${baseRef}`,
		],
		{ stdout: "pipe", stderr: "pipe", env },
	);
	const countOut = await new Response(countProc.stdout).text();
	const countExit = await countProc.exited;
	const commitsBehind = countExit === 0 ? parseInt(countOut.trim(), 10) || 0 : 0;

	const subjectsProc = spawn(
		[
			"git",
			"-C",
			worktreePath,
			"log",
			"--pretty=%s",
			"-5",
			`HEAD..origin/${baseRef}`,
		],
		{ stdout: "pipe", stderr: "pipe", env },
	);
	const subjectsOut = await new Response(subjectsProc.stdout).text();
	await subjectsProc.exited;
	const recentSubjects = subjectsOut
		.split("\n")
		.map((s) => s.trim())
		.filter(Boolean);

	return { commitsBehind, recentSubjects };
}

export interface DispatchSpecLike {
	allowStaleBase?: boolean;
}

export function shouldRefuseDispatch(
	drift: DriftReport,
	spec: DispatchSpecLike,
): boolean {
	if (drift.commitsBehind < DISPATCH_STALE_THRESHOLD) return false;
	if (spec.allowStaleBase === true) return false;
	return true;
}
