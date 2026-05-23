import { FC, CSSProperties } from "react";
import {
	DragDropContext,
	Droppable,
	Draggable,
	type DropResult,
} from "@hello-pangea/dnd";
import { useAtomValue, useSetAtom } from "jotai/react";
import { tasksAtom, upsertTaskAtom, type TaskStatus } from "../store/dagStore";
import { AgentStateDot, type AgentState } from "./AgentStateDot";

// Steal from vibe-kanban (apps/web/src/components/kanban/Board.tsx): 4 swim
// lanes wired to dagStore. Note: there is no dedicated `updateTaskStatusAtom`
// in dagStore yet, so onDragEnd uses `upsertTaskAtom` to rewrite the moved
// task with its new status. A focused status-updater is a follow-up.

interface ColumnDef {
	id: string;
	title: string;
	statuses: readonly TaskStatus[];
	// The status assigned to a task dropped into this column.
	defaultStatus: TaskStatus;
}

const COLUMNS: readonly ColumnDef[] = [
	{
		id: "ready",
		title: "Ready",
		statuses: ["pending", "ready"],
		defaultStatus: "ready",
	},
	{
		id: "in_progress",
		title: "In Progress",
		statuses: ["dispatched"],
		defaultStatus: "dispatched",
	},
	{
		id: "verifying",
		title: "Verifying",
		statuses: ["in_verification"],
		defaultStatus: "in_verification",
	},
	{
		id: "done",
		title: "Done",
		statuses: ["done"],
		defaultStatus: "done",
	},
];

function mapStatusToDotState(status: TaskStatus): AgentState {
	switch (status) {
		case "in_verification":
		case "dispatched":
			return "working";
		case "blocked":
		case "failed":
			return "error";
		case "done":
			return "done";
		default:
			return "idle";
	}
}

export const KanbanBoard: FC = () => {
	const tasks = useAtomValue(tasksAtom);
	const upsertTask = useSetAtom(upsertTaskAtom);

	const taskArray = Object.values(tasks ?? {});

	const onDragEnd = (result: DropResult) => {
		const { destination, draggableId } = result;
		if (!destination) return;
		const targetCol = COLUMNS.find((c) => c.id === destination.droppableId);
		if (!targetCol) return;
		const task = tasks[draggableId];
		if (!task) return;
		if (task.status === targetCol.defaultStatus) return;
		upsertTask({ ...task, status: targetCol.defaultStatus });
	};

	const containerStyle: CSSProperties = {
		display: "grid",
		gridTemplateColumns: "repeat(4, 1fr)",
		gap: 12,
		padding: 16,
	};

	const columnStyle: CSSProperties = {
		background: "var(--surface)",
		border: "1px solid var(--border)",
		padding: 12,
		minHeight: 200,
	};

	const cardStyle: CSSProperties = {
		background: "var(--surface-elevated)",
		border: "1px solid var(--border)",
		padding: 8,
		marginBottom: 6,
		fontFamily: "var(--font-mono)",
		fontSize: 11,
		display: "flex",
		alignItems: "center",
		gap: 6,
	};

	return (
		<DragDropContext onDragEnd={onDragEnd}>
			<div style={containerStyle}>
				{COLUMNS.map((col) => {
					const colTasks = taskArray.filter((t) =>
						col.statuses.includes(t.status),
					);
					return (
						<Droppable key={col.id} droppableId={col.id}>
							{(provided) => (
								<section
									ref={provided.innerRef}
									{...provided.droppableProps}
									aria-label={col.title}
									style={columnStyle}
								>
									<h2
										className="font-display"
										style={{
											color: "var(--apohara-lime)",
											fontSize: 12,
											marginBottom: 8,
										}}
									>
										{col.title}
									</h2>
									{colTasks.map((task, idx) => (
										<Draggable
											key={task.id}
											draggableId={task.id}
											index={idx}
										>
											{(prov) => (
												<article
													ref={prov.innerRef}
													{...prov.draggableProps}
													{...prov.dragHandleProps}
													style={{
														...cardStyle,
														...prov.draggableProps.style,
													}}
												>
													<AgentStateDot
														state={mapStatusToDotState(task.status)}
														size="sm"
													/>
													<span
														style={{
															overflow: "hidden",
															textOverflow: "ellipsis",
															whiteSpace: "nowrap",
														}}
													>
														{task.title ?? task.id}
													</span>
												</article>
											)}
										</Draggable>
									))}
									{provided.placeholder}
								</section>
							)}
						</Droppable>
					);
				})}
			</div>
		</DragDropContext>
	);
};

export default KanbanBoard;
