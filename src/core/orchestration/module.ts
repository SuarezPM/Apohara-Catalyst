/**
 * OrchestrationModule — M018 Pattern A.
 *
 * Narrow contract per concrete orchestrator class so callers can inject
 * mocks or alternative implementations without touching call sites.
 *
 * Surface is intentionally minimal: only the methods that scheduler.ts and
 * subagent-manager.ts already invoke today. Adapters keep the existing
 * method names from the concrete classes (PURE REFACTOR — see plan rule
 * "If a method already has a distinct name, extend the interface to match
 * the current name").
 *
 * The 8 adapters are independent enough that a partial OrchestrationModule
 * is also useful (a single test can stub one adapter and pull the rest from
 * `DefaultOrchestrationModule`).
 */

import type { ConsolidationResult } from "../consolidator";
import type { DecomposedTask, DecompositionResult } from "../decomposer";
import type { TaskExecutionResult } from "../scheduler";
import type { SubagentResult } from "../subagent-manager";
import type {
	EventLog,
	EventSeverity,
	ProviderId,
	TaskRole,
} from "../types";
import type { MeshExecutionOptions, MeshResult } from "../verification-mesh";
import type { WorktreeEntry } from "../worktree-manager";

/**
 * PlannerAdapter — top-level "what is the next slice of work?" contract.
 *
 * Apohara has no standalone Planner today; TaskDecomposer absorbs both
 * planning and decomposition. We model it as a discrete adapter so the
 * orchestrator could later split them without touching this interface.
 */
export interface PlannerAdapter {
	planSlice(prompt: string): Promise<DecomposedTask[]>;
}

/**
 * DecomposerAdapter — splits a prompt into a DAG of DecomposedTask nodes.
 *
 * Matches `TaskDecomposer.decompose` exactly.
 */
export interface DecomposerAdapter {
	decompose(prompt: string): Promise<DecompositionResult>;
}

/**
 * SchedulerAdapter — drives a DAG of tasks to completion via worktree pool.
 *
 * Matches `ParallelScheduler.executeAll` exactly.
 */
export interface SchedulerAdapter {
	executeAll(tasks: DecomposedTask[]): Promise<TaskExecutionResult[]>;
}

/**
 * SubagentAdapter — fans out role-labeled subagents in parallel.
 *
 * Matches `SubagentManager.executeAll` exactly. We keep the same input
 * shape (id/description/dependencies/role) the concrete class expects.
 */
export interface SubagentAdapter {
	executeAll(
		tasks: Array<{
			id: string;
			description: string;
			dependencies: string[];
			role: TaskRole;
		}>,
	): Promise<SubagentResult[]>;
}

/**
 * VerifierAdapter — runs the dual-arbiter verification mesh.
 *
 * Matches `VerificationMesh.execute` exactly.
 */
export interface VerifierAdapter {
	execute(options: MeshExecutionOptions): Promise<MeshResult>;
}

/**
 * ConsolidatorAdapter — merges successful worktrees back into trunk.
 *
 * Matches `Consolidator.run` exactly.
 */
export interface ConsolidatorAdapter {
	run(): Promise<ConsolidationResult>;
}

/**
 * LedgerAdapter — append-only hash-chained event log.
 *
 * Matches `EventLedger.log` and `logProviderOutcome` exactly.
 */
export interface LedgerAdapter {
	log(
		type: string,
		payload: Record<string, unknown>,
		severity?: EventSeverity,
		taskId?: string,
		metadata?: EventLog["metadata"],
	): Promise<void>;

	logProviderOutcome(
		provider: ProviderId,
		role: TaskRole,
		success: boolean,
		options?: {
			taskId?: string;
			errorReason?: string;
			explored?: boolean;
		},
	): Promise<void>;
}

/**
 * WorktreeAdapter — disk-level lifecycle for managed worktrees.
 *
 * Matches `WorktreeManager.create` and `cleanup` exactly (the plan-listed
 * minimum). We extend with `list` so Pattern F's state command can
 * enumerate worktrees through the adapter rather than reaching into the
 * concrete class.
 */
export interface WorktreeAdapter {
	create(taskId: string): Promise<string>;
	cleanup(taskId: string): Promise<void>;
	list(): Promise<WorktreeEntry[]>;
}

/**
 * Aggregate root — wires all 8 adapters into a single injection seam.
 */
export interface OrchestrationModule {
	planner: PlannerAdapter;
	decomposer: DecomposerAdapter;
	scheduler: SchedulerAdapter;
	subagent: SubagentAdapter;
	verifier: VerifierAdapter;
	consolidator: ConsolidatorAdapter;
	ledger: LedgerAdapter;
	worktree: WorktreeAdapter;
}
