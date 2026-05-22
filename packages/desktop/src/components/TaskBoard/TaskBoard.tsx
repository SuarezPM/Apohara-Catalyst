import { useTaskBoardStore } from "../../store/use-taskboard-store.js";
import { TaskBoardLane } from "./TaskBoardLane.js";

/**
 * TaskBoard kanban view per spec §4. Renders one `TaskBoardLane` per
 * status. Reads from the SAME store as `SwarmCanvas` (DAG view) — the
 * shared store is the spec's "single source of truth" rule.
 */
export function TaskBoard() {
	const { tasksByStatus, statuses } = useTaskBoardStore();
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
			{statuses.map((status) => (
				<TaskBoardLane
					key={status}
					status={status}
					tasks={tasksByStatus[status]}
				/>
			))}
		</div>
	);
}
