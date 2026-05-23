/**
 * TeammateIdle dispatch — claude-octopus hallazgo 7 (G5.B.10).
 *
 * Apohara's ExecutorAction chain is PUSH-based — pre-constructed
 * before the run starts, then walked. claude-octopus introduces a
 * complementary PULL-based pattern: when an agent finishes its
 * sub-task and goes IDLE, the dispatcher can route a pending task its
 * way. This unlocks multi-agent delegation patterns ("once the coder
 * is done, hand the next task to whoever is idle") without
 * pre-planning the full DAG.
 *
 * The roster is the runtime state:
 *   - agents register themselves (capabilities + id)
 *   - markBusy(id, taskId) when picking up work
 *   - markIdle(id, taskId?) when handing off
 *   - pickIdleAgent / pickIdleAgentForCapability for the dispatcher
 *
 * Pure value module — coordinator owns timing; state transitions are
 * agent-supplied via the markBusy / markIdle helpers.
 *
 * Note: this is intentionally SIMPLE — no health checks, no
 * heart-beat. The reconciler stall-detection pass (G5.B.2) handles
 * lost workers via the existing instruction-file age check; the
 * roster only models the IDLE/BUSY axis.
 */

export type AgentCapability = "coder" | "critic" | "judge" | "planner";

export interface AgentSlot {
	id: string;
	capabilities: AgentCapability[];
	currentTaskId: string | null;
}

export interface TeammateRoster {
	agents: Record<string, AgentSlot>;
}

export function newTeammateRoster(): TeammateRoster {
	return { agents: {} };
}

export interface RegisterAgentInput {
	id: string;
	capabilities: AgentCapability[];
}

export function registerAgent(
	roster: TeammateRoster,
	input: RegisterAgentInput,
): TeammateRoster {
	const existing = roster.agents[input.id];
	const slot: AgentSlot = {
		id: input.id,
		capabilities: input.capabilities,
		// Preserve in-flight task id if the agent was already known —
		// re-registering must NOT reset BUSY state (could lose track of
		// a worker mid-task).
		currentTaskId: existing?.currentTaskId ?? null,
	};
	return { agents: { ...roster.agents, [input.id]: slot } };
}

export function markBusy(
	roster: TeammateRoster,
	agentId: string,
	taskId: string,
): TeammateRoster {
	const existing = roster.agents[agentId];
	if (!existing) return roster; // unknown agent — no-op
	if (existing.currentTaskId !== null) return roster; // already busy — preserve
	return {
		agents: {
			...roster.agents,
			[agentId]: { ...existing, currentTaskId: taskId },
		},
	};
}

export function markIdle(
	roster: TeammateRoster,
	agentId: string,
	_finishedTaskId?: string,
): TeammateRoster {
	const existing = roster.agents[agentId];
	if (!existing) return roster; // defensive: ignore unknown agents
	return {
		agents: {
			...roster.agents,
			[agentId]: { ...existing, currentTaskId: null },
		},
	};
}

export function isIdle(roster: TeammateRoster, agentId: string): boolean {
	const a = roster.agents[agentId];
	if (!a) return false; // unknown agents are NOT idle
	return a.currentTaskId === null;
}

/**
 * Return any idle agent, picked deterministically (lex-first by id)
 * for stability across ticks.
 */
export function pickIdleAgent(roster: TeammateRoster): string | null {
	const idleIds = Object.keys(roster.agents)
		.filter((id) => roster.agents[id]?.currentTaskId === null)
		.sort();
	return idleIds[0] ?? null;
}

export function pickIdleAgentForCapability(
	roster: TeammateRoster,
	capability: AgentCapability,
): string | null {
	const matching = Object.keys(roster.agents)
		.filter((id) => {
			const a = roster.agents[id];
			return (
				a?.currentTaskId === null && a.capabilities.includes(capability)
			);
		})
		.sort();
	return matching[0] ?? null;
}
