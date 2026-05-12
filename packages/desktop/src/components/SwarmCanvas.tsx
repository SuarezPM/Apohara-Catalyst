import {
	Background,
	Controls,
	type Edge,
	type Node,
	ReactFlow,
} from "@xyflow/react";
import { useMemo } from "react";
import "@xyflow/react/dist/style.css";
import type { EventLog } from "../lib/types.js";

interface SwarmCanvasProps {
	events: EventLog[];
}

type TaskState = "scheduled" | "completed" | "failed";

interface TaskNodeData extends Record<string, unknown> {
	label: string;
	state: TaskState;
	provider?: string;
}

interface DecomposerTask {
	id: string;
	title?: string;
	dependsOn?: string[];
}

/**
 * Renders the swarm DAG from the live ledger event stream.
 *
 * Topology source: `decomposer_complete` event payload — emitted once when the
 * objective is broken into tasks. Each subsequent `task_scheduled` /
 * `task_completed` event updates the corresponding node's state.
 *
 * Verification mesh verdicts appear as violet sentinel nodes attached to the
 * task they verified.
 */
export function SwarmCanvas({ events }: SwarmCanvasProps) {
	const { nodes, edges } = useMemo(() => buildGraph(events), [events]);

	return (
		<section className="pane pane-canvas">
			<h2 className="pane-title">Swarm</h2>
			<div className="swarm-flow">
				{nodes.length === 0 ? (
					<div className="empty">
						DAG appears here once an objective is decomposed
					</div>
				) : (
					<ReactFlow
						nodes={nodes}
						edges={edges}
						fitView
						nodesDraggable={false}
						nodesConnectable={false}
						elementsSelectable={false}
						proOptions={{ hideAttribution: true }}
					>
						<Background gap={24} size={1} color="#1e1e2e" />
						<Controls showInteractive={false} />
					</ReactFlow>
				)}
			</div>
		</section>
	);
}

function buildGraph(events: EventLog[]): {
	nodes: Node<TaskNodeData>[];
	edges: Edge[];
} {
	const tasks = new Map<string, DecomposerTask>();
	const state = new Map<string, TaskState>();
	const providers = new Map<string, string>();
	const meshVerdicts: { id: string; targetTaskId: string; verdict: string }[] =
		[];

	for (const ev of events) {
		if (ev.type === "decomposer_complete" && Array.isArray(ev.payload?.tasks)) {
			for (const raw of ev.payload.tasks as DecomposerTask[]) {
				if (raw?.id && !tasks.has(raw.id)) {
					tasks.set(raw.id, raw);
					state.set(raw.id, "scheduled");
				}
			}
		}
		if (ev.type === "task_scheduled" && ev.taskId) {
			if (!tasks.has(ev.taskId)) {
				tasks.set(ev.taskId, {
					id: ev.taskId,
					title:
						typeof ev.payload?.title === "string"
							? ev.payload.title
							: ev.taskId,
				});
			}
			state.set(ev.taskId, "scheduled");
			if (ev.metadata?.provider) providers.set(ev.taskId, ev.metadata.provider);
		}
		if (ev.type === "task_completed" && ev.taskId) {
			state.set(ev.taskId, "completed");
		}
		if (ev.type === "task_failed" && ev.taskId) {
			state.set(ev.taskId, "failed");
		}
		if (ev.type === "mesh_verdict" && ev.taskId) {
			meshVerdicts.push({
				id: ev.id,
				targetTaskId: ev.taskId,
				verdict: String(ev.payload?.verdict ?? "verified"),
			});
		}
	}

	// Topological depth (longest path from a root) for layered layout.
	const depth = new Map<string, number>();
	function computeDepth(id: string, seen: Set<string>): number {
		if (depth.has(id)) return depth.get(id)!;
		if (seen.has(id)) return 0; // cycle guard
		seen.add(id);
		const t = tasks.get(id);
		const parents = t?.dependsOn?.filter((p) => tasks.has(p)) ?? [];
		const d =
			parents.length === 0
				? 0
				: 1 + Math.max(...parents.map((p) => computeDepth(p, seen)));
		depth.set(id, d);
		return d;
	}
	for (const id of tasks.keys()) computeDepth(id, new Set());

	// Place nodes column-by-column at depth d, stagger vertically by appearance.
	const columnCount = new Map<number, number>();
	const nodes: Node<TaskNodeData>[] = [];
	for (const [id, t] of tasks) {
		const d = depth.get(id) ?? 0;
		const row = columnCount.get(d) ?? 0;
		columnCount.set(d, row + 1);
		nodes.push({
			id,
			data: {
				label: t.title || id,
				state: state.get(id) ?? "scheduled",
				provider: providers.get(id),
			},
			position: { x: d * 220, y: row * 80 },
			className: state.get(id) ?? "scheduled",
		});
	}

	const edges: Edge[] = [];
	for (const t of tasks.values()) {
		for (const parent of t.dependsOn ?? []) {
			if (tasks.has(parent)) {
				edges.push({
					id: `${parent}->${t.id}`,
					source: parent,
					target: t.id,
					animated: state.get(t.id) === "scheduled",
				});
			}
		}
	}

	// Mesh verdict sentinels — one per verdict, anchored below the task it judges.
	for (const m of meshVerdicts) {
		const targetNode = nodes.find((n) => n.id === m.targetTaskId);
		if (!targetNode) continue;
		const sentinelId = `mesh-${m.id}`;
		nodes.push({
			id: sentinelId,
			data: { label: `⚖ ${m.verdict}`, state: "completed" },
			position: {
				x: targetNode.position.x + 40,
				y: targetNode.position.y + 60,
			},
			className: "mesh",
			selectable: false,
		});
		edges.push({
			id: `${m.targetTaskId}->${sentinelId}`,
			source: m.targetTaskId,
			target: sentinelId,
			style: { strokeDasharray: "4 4", stroke: "#a78bfa" },
		});
	}

	return { nodes, edges };
}
