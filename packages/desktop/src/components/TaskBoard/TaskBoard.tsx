import { useMemo } from "react";
import type { EventLog } from "../../../../../src/core/types.js";
import {
	projectToUiCards,
	type UiTaskCard,
} from "../../../../../src/core/projector/transcript-transformer.js";
import {
	ALL_STATUSES,
	type DagTask,
	type TaskStatus,
} from "../../store/dagStore.js";
import { useTaskBoardStore } from "../../store/use-taskboard-store.js";
import { TaskBoardLane } from "./TaskBoardLane.js";

/**
 * TaskBoard kanban view per spec §4.
 *
 * Two input modes (both feed the same `TaskBoardLane` columns):
 *
 *   1. Default — read from the shared jotai store (`useTaskBoardStore`),
 *      which `SwarmCanvas` (DAG view) also reads. Spec §4 single-source-
 *      of-truth rule: one task object, two surfaces.
 *
 *   2. With `events` prop — derive cards directly from raw ledger
 *      `EventLog[]` via `projectToUiCards` (G5.F.1's two-tier canonical
 *      projection per nimbalyst #5.1). This avoids the manual switch-case
 *      re-parse in `App.tsx::useEffect` and pays the parse cost once at
 *      the boundary instead of on every render.
 *
 * The projector emits `UiTaskCard` (per-task status snapshot). The store
 * speaks `DagTask` (a richer per-task record with cost/duration/etc).
 * `cardsToDagTasks` does the minimal field-by-field copy so both paths
 * render through the same `TaskBoardLane` and downstream
 * `TaskBoardCard` — there's no visual fork between the two modes.
 */
export function TaskBoard({ events }: { events?: EventLog[] }) {
	const { tasksByStatus } = useTaskBoardStore();
	const projectedByStatus = useMemo(() => {
		if (!events) return null;
		const cards = projectToUiCards(events);
		return cardsToBuckets(cards);
	}, [events]);

	const buckets = projectedByStatus ?? tasksByStatus;
	return (
		<div
			data-testid="taskboard"
			style={{
				display: "flex",
				flexDirection: "row",
				gap: "0.75rem",
				padding: "1rem",
				overflowX: "auto",
				height: "100%",
				background: "#0c0c10",
			}}
		>
			{ALL_STATUSES.map((status) => (
				<TaskBoardLane
					key={status}
					status={status}
					tasks={buckets[status]}
				/>
			))}
		</div>
	);
}

/**
 * Bridge `UiTaskCard` (projector output) to the kanban's `DagTask` shape.
 *
 * Status mapping is intentionally narrow: the projector only emits the
 * three lifecycle states it can read from the ledger
 * (`pending` / `completed` / `failed`). The board's other lanes
 * (`ready`, `dispatched`, `in_verification`, `blocked`) stay empty under
 * the events-only path — they're populated by the orchestration store
 * when the desktop is wired to the live jotai listeners.
 */
function cardsToBuckets(cards: UiTaskCard[]): Record<TaskStatus, DagTask[]> {
	const buckets: Record<TaskStatus, DagTask[]> = {
		pending: [],
		ready: [],
		dispatched: [],
		in_verification: [],
		done: [],
		failed: [],
		blocked: [],
	};
	for (const card of cards) {
		const status: TaskStatus = card.status === "completed" ? "done" : card.status;
		const bucket = buckets[status];
		if (!bucket) continue;
		bucket.push({
			id: card.taskId,
			title: card.prompt ?? card.taskId,
			status,
			providerId: normalizeProviderId(card.providerId),
			durationMs: card.durationMs,
		});
	}
	return buckets;
}

function normalizeProviderId(
	id: string | undefined,
): DagTask["providerId"] | undefined {
	if (id === "claude-code-cli" || id === "codex-cli" || id === "opencode-go") {
		return id;
	}
	return undefined;
}
