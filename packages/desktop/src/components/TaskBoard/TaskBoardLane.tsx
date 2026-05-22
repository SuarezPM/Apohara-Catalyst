import type { DagTask, TaskStatus } from "../../store/dagStore.js";

interface TaskBoardLaneProps {
	status: TaskStatus;
	tasks: DagTask[];
}

const STATUS_LABEL: Record<TaskStatus, string> = {
	pending: "Pending",
	ready: "Ready",
	dispatched: "Dispatched",
	in_verification: "Verification",
	done: "Done",
	failed: "Failed",
	blocked: "Blocked",
};

const STATUS_COLOR: Record<TaskStatus, string> = {
	pending: "#6e7681",
	ready: "#3fb950",
	dispatched: "#58a6ff",
	in_verification: "#d29922",
	done: "#3fb950",
	failed: "#f85149",
	blocked: "#a371f7",
};

export function TaskBoardLane({ status, tasks }: TaskBoardLaneProps) {
	const accent = STATUS_COLOR[status];
	return (
		<div
			data-testid={`taskboard-lane-${status}`}
			style={{
				minWidth: 240,
				flex: "0 0 240px",
				background: "#161b22",
				borderRadius: 6,
				border: `1px solid ${accent}33`,
				display: "flex",
				flexDirection: "column",
			}}
		>
			<header
				style={{
					padding: "0.5rem 0.75rem",
					fontWeight: 600,
					fontSize: "0.85rem",
					color: accent,
					borderBottom: `1px solid ${accent}33`,
				}}
			>
				{STATUS_LABEL[status]} ({tasks.length})
			</header>
			<div
				style={{
					padding: "0.5rem",
					display: "flex",
					flexDirection: "column",
					gap: "0.5rem",
					overflowY: "auto",
				}}
			>
				{tasks.map((task) => (
					<div
						key={task.id}
						data-testid={`taskboard-card-${task.id}`}
						style={{
							padding: "0.5rem",
							background: "#0d1117",
							borderRadius: 4,
							border: "1px solid #30363d",
							fontSize: "0.85rem",
						}}
					>
						<div style={{ fontWeight: 600 }}>{task.id}</div>
						<div
							style={{
								color: "#8b949e",
								fontSize: "0.75rem",
								marginTop: 2,
							}}
						>
							{task.title}
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
