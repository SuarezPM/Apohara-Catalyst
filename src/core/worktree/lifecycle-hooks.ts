/**
 * multica #16 — 4-phase worktree lifecycle hooks.
 *
 * The worktree manager (`src/core/worktree-manager.ts`) and the
 * higher-level subagent manager need extension points around
 * create / teardown so callers can inject behavior without forking
 * the manager itself. Typical uses:
 *
 *   - pre-create: validate budget / config before reserving FS
 *   - post-create: seed config files, register telemetry probe
 *   - pre-teardown: snapshot state, flush logs, drain in-flight RPCs
 *   - post-teardown: GC orphan tracking entries, emit metrics
 *
 * Contract differences between create and teardown phases:
 *
 *   - create phases (pre-create, post-create) FAIL FAST: a hook
 *     throwing aborts the rest of the phase AND propagates to the
 *     caller, who is expected to back out of the create.
 *
 *   - teardown phases (pre-teardown, post-teardown) ARE BEST EFFORT:
 *     a hook throwing is swallowed so subsequent cleanup still runs.
 *     Callers that want the error list can use
 *     `runPhaseCollectErrors` instead of `runPhase`.
 *
 * This asymmetry matches the failure modes: create can be safely
 * aborted (we just don't create), but teardown failures already mean
 * something is wrong and stopping cleanup makes the leak worse.
 */

export type LifecyclePhase =
	| "pre-create"
	| "post-create"
	| "pre-teardown"
	| "post-teardown";

export interface LifecycleContext {
	taskId: string;
	path: string;
	branch: string;
}

export type LifecycleHook = (ctx: LifecycleContext) => Promise<void>;

const TEARDOWN_PHASES: ReadonlySet<LifecyclePhase> = new Set([
	"pre-teardown",
	"post-teardown",
]);

export class WorktreeLifecycleHooks {
	private byPhase = new Map<LifecyclePhase, LifecycleHook[]>();

	register(phase: LifecyclePhase, hook: LifecycleHook): void {
		const arr = this.byPhase.get(phase) ?? [];
		arr.push(hook);
		this.byPhase.set(phase, arr);
	}

	unregister(phase: LifecyclePhase, hook: LifecycleHook): void {
		const arr = this.byPhase.get(phase);
		if (!arr) return;
		const idx = arr.indexOf(hook);
		if (idx >= 0) arr.splice(idx, 1);
	}

	countByPhase(phase: LifecyclePhase): number {
		return this.byPhase.get(phase)?.length ?? 0;
	}

	/**
	 * Run all hooks for `phase` in registration order.
	 *
	 *   - On create phases: a thrown error aborts subsequent hooks and
	 *     rejects the returned promise.
	 *   - On teardown phases: errors are swallowed (best-effort cleanup).
	 *     Use `runPhaseCollectErrors` to inspect them.
	 */
	async runPhase(phase: LifecyclePhase, ctx: LifecycleContext): Promise<void> {
		const hooks = this.byPhase.get(phase) ?? [];
		const isTeardown = TEARDOWN_PHASES.has(phase);
		for (const hook of hooks) {
			try {
				await hook(ctx);
			} catch (err) {
				if (!isTeardown) throw err;
				// Teardown: swallow but emit a structured warn so the failure
				// is visible in logs without breaking cleanup.
				console.warn(
					`[worktree.lifecycle] ${phase} hook failed (swallowed): ${
						(err as Error).message ?? String(err)
					}`,
				);
			}
		}
	}

	/**
	 * Like runPhase but collects every error instead of throwing or
	 * logging. Useful for teardown callers that want a structured
	 * summary (e.g. surfacing in `apohara state --json`).
	 */
	async runPhaseCollectErrors(
		phase: LifecyclePhase,
		ctx: LifecycleContext,
	): Promise<Error[]> {
		const errors: Error[] = [];
		const hooks = this.byPhase.get(phase) ?? [];
		for (const hook of hooks) {
			try {
				await hook(ctx);
			} catch (err) {
				errors.push(err instanceof Error ? err : new Error(String(err)));
			}
		}
		return errors;
	}
}
