/**
 * DefaultOrchestrationModule — wires the 8 default adapters together.
 *
 * Apohara's concrete classes satisfy the adapter interfaces via TypeScript
 * structural typing — they already expose `decompose`, `executeAll`,
 * `execute`, `run`, `log`, `create`, `cleanup`, etc. We rely on structural
 * compliance so the concrete classes need not import the adapter types
 * (keeping the refactor surgical — see M018 Pattern A plan rule "PURE
 * REFACTOR — SOLO agregás `implements X` annotations").
 *
 * If a concrete class later drifts and stops matching its adapter, the
 * type assertions in `createDefaultOrchestrationModule` will fail at
 * compile time, surfacing the drift before runtime.
 */

import { Consolidator } from "../consolidator";
import { TaskDecomposer } from "../decomposer";
import { EventLedger } from "../ledger";
import { ParallelScheduler } from "../scheduler";
import { SubagentManager } from "../subagent-manager";
import { VerificationMesh } from "../verification-mesh";
import { WorktreeManager } from "../worktree-manager";
import type { DecomposedTask } from "../decomposer";
import type {
	ConsolidatorAdapter,
	DecomposerAdapter,
	LedgerAdapter,
	OrchestrationModule,
	PlannerAdapter,
	SchedulerAdapter,
	SubagentAdapter,
	VerifierAdapter,
	WorktreeAdapter,
} from "./module";

/**
 * Trivial pass-through Planner that delegates to the Decomposer.
 *
 * Apohara has no standalone Planner class yet; TaskDecomposer handles both
 * planning and decomposition. This adapter exposes the planning slice
 * through a stable name so callers can swap in a real Planner later.
 */
class DefaultPlanner implements PlannerAdapter {
	constructor(private readonly decomposer: TaskDecomposer) {}

	async planSlice(prompt: string): Promise<DecomposedTask[]> {
		const result = await this.decomposer.decompose(prompt);
		return result.tasks;
	}
}

export interface DefaultModuleOptions {
	ledger?: EventLedger;
	worktreeManager?: WorktreeManager;
	decomposer?: TaskDecomposer;
	scheduler?: ParallelScheduler;
	subagent?: SubagentManager;
	verifier?: VerificationMesh;
	consolidator?: Consolidator;
}

/**
 * Build an OrchestrationModule wired to Apohara's real concrete classes.
 *
 * All adapters share `ledger` and `worktreeManager` so subagent traffic
 * lands on the same hash-chained log and worktree pool.
 *
 * The `satisfies` checks below are compile-time assertions that each
 * concrete class structurally conforms to its adapter contract.
 */
export function createDefaultOrchestrationModule(
	options: DefaultModuleOptions = {},
): OrchestrationModule {
	const ledger = options.ledger ?? new EventLedger();
	const worktreeManager = options.worktreeManager ?? new WorktreeManager();
	const decomposer = options.decomposer ?? new TaskDecomposer();
	const scheduler =
		options.scheduler ??
		new ParallelScheduler(undefined, undefined, ledger, undefined);
	const subagent = options.subagent ?? new SubagentManager();
	const verifier = options.verifier ?? new VerificationMesh();
	const consolidator =
		options.consolidator ?? new Consolidator(undefined, ledger);

	return {
		planner: new DefaultPlanner(decomposer),
		decomposer: decomposer satisfies DecomposerAdapter,
		scheduler: scheduler satisfies SchedulerAdapter,
		subagent: subagent satisfies SubagentAdapter,
		verifier: verifier satisfies VerifierAdapter,
		consolidator: consolidator satisfies ConsolidatorAdapter,
		ledger: ledger satisfies LedgerAdapter,
		worktree: worktreeManager satisfies WorktreeAdapter,
	};
}
