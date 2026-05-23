/**
 * PermissionGridPanel — UI surface for the chorus H10 permission grid
 * (G5.D.6 resolved the model; G7.C.1 wires it to the desktop UI).
 *
 * The grid is a flat table of `(scope, resource) → state` rows where:
 *   - `scope` is one of "once" / "session" / "always" (independent cells)
 *   - `state` is "allow" / "deny" / "unset" (unset clears the cell)
 *
 * The same resource can have different states across scopes — that is the
 * core property the grid model adds over a single boolean per resource.
 * For example: `Bash(rm:*)` allowed once but denied for the session is a
 * coherent and supported configuration.
 *
 * This panel is dev-mode visible; the orchestrator-side authoritative
 * state lives in `src/core/safety/permissionGrid.ts`. The two will sync
 * over Tauri events in v1.1 — for now the panel keeps its own jotai-backed
 * snapshot so users can preview rules before they're applied.
 */
import { atom } from "jotai/vanilla";
import { useAtomValue, useSetAtom } from "jotai/react";
import { useState } from "react";

export type PermissionScope = "once" | "session" | "always";
export type PermissionState = "allow" | "deny" | "unset";

export interface GridRow {
	scope: PermissionScope;
	resource: string;
	state: PermissionState;
}

const SCOPES: readonly PermissionScope[] = ["once", "session", "always"];

function rowKey(scope: PermissionScope, resource: string): string {
	return `${scope}::${resource}`;
}

/** Flat row map. Empty by default — populated as the user adds rules. */
export const permissionGridAtom = atom<Record<string, GridRow>>({});

export const setGridCellAtom = atom(
	null,
	(get, set, args: { scope: PermissionScope; resource: string; state: PermissionState }) => {
		const current = get(permissionGridAtom);
		const key = rowKey(args.scope, args.resource);
		if (args.state === "unset") {
			if (!(key in current)) return;
			const { [key]: _drop, ...rest } = current;
			set(permissionGridAtom, rest);
			return;
		}
		set(permissionGridAtom, {
			...current,
			[key]: { scope: args.scope, resource: args.resource, state: args.state },
		});
	},
);

const STATE_STYLE: Record<PermissionState, { bg: string; color: string; label: string }> = {
	allow: { bg: "#0d2818", color: "#3fb950", label: "ALLOW" },
	deny: { bg: "#2d1010", color: "#f85149", label: "DENY" },
	unset: { bg: "transparent", color: "#7d8590", label: "—" },
};

interface CellProps {
	scope: PermissionScope;
	resource: string;
}

function GridCell({ scope, resource }: CellProps) {
	const grid = useAtomValue(permissionGridAtom);
	const setCell = useSetAtom(setGridCellAtom);
	const current = grid[rowKey(scope, resource)]?.state ?? "unset";
	const style = STATE_STYLE[current];

	const cycle = (): PermissionState => {
		if (current === "unset") return "allow";
		if (current === "allow") return "deny";
		return "unset";
	};

	return (
		<button
			type="button"
			data-testid={`grid-cell-${scope}-${resource}`}
			data-state={current}
			onClick={() => setCell({ scope, resource, state: cycle() })}
			style={{
				padding: "0.25rem 0.5rem",
				border: "1px solid #30363d",
				background: style.bg,
				color: style.color,
				fontFamily: "var(--mono, monospace)",
				fontSize: "0.7rem",
				fontWeight: 600,
				cursor: "pointer",
				borderRadius: 3,
				minWidth: 60,
			}}
			title={`${scope} / ${resource} — click to cycle (allow → deny → unset)`}
		>
			{style.label}
		</button>
	);
}

export function PermissionGridPanel() {
	const grid = useAtomValue(permissionGridAtom);
	const setCell = useSetAtom(setGridCellAtom);
	const [newResource, setNewResource] = useState("");

	// Collect unique resources from current rows so the table renders the
	// 3-column matrix per resource. The empty input is the "add a row" hook.
	const resources = Array.from(
		new Set(Object.values(grid).map((r) => r.resource)),
	).sort();

	const addResource = () => {
		const trimmed = newResource.trim();
		if (!trimmed) return;
		// Default new rows to `once / unset` so they show up in the table
		// without committing the user to a decision.
		setCell({ scope: "once", resource: trimmed, state: "unset" });
		// Also seed session + always with unset so all 3 cells render in
		// the new row (vs. only `once` because that's the only key we wrote).
		setCell({ scope: "session", resource: trimmed, state: "unset" });
		setCell({ scope: "always", resource: trimmed, state: "unset" });
		setNewResource("");
	};

	return (
		<section
			data-testid="permission-grid-panel"
			style={{
				background: "#0d1117",
				border: "1px solid #30363d",
				borderRadius: 6,
				padding: "0.75rem",
				color: "#e6edf3",
				fontSize: "0.8rem",
			}}
		>
			<header
				style={{
					display: "flex",
					alignItems: "center",
					gap: "0.5rem",
					marginBottom: "0.5rem",
				}}
			>
				<strong style={{ fontSize: "0.85rem" }}>Permission grid</strong>
				<span style={{ color: "#7d8590", fontSize: "0.7rem" }}>
					chorus H10 — per-(scope, resource) rules
				</span>
			</header>

			<div
				style={{
					display: "flex",
					gap: "0.4rem",
					marginBottom: "0.5rem",
				}}
			>
				<input
					data-testid="grid-add-resource-input"
					placeholder="e.g. Bash(rm:*), Read(/etc/*)"
					value={newResource}
					onChange={(e) => setNewResource(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") addResource();
					}}
					style={{
						flex: 1,
						padding: "0.3rem 0.5rem",
						background: "#0c0c10",
						border: "1px solid #30363d",
						borderRadius: 3,
						color: "#e6edf3",
						fontFamily: "var(--mono, monospace)",
						fontSize: "0.75rem",
					}}
				/>
				<button
					type="button"
					data-testid="grid-add-resource-button"
					onClick={addResource}
					style={{
						padding: "0.3rem 0.7rem",
						background: "#21262d",
						color: "#e6edf3",
						border: "1px solid #30363d",
						borderRadius: 3,
						cursor: "pointer",
						fontSize: "0.75rem",
					}}
				>
					+ Add row
				</button>
			</div>

			{resources.length === 0 ? (
				<p
					data-testid="grid-empty"
					style={{ color: "#7d8590", fontSize: "0.75rem", margin: "0.5rem 0" }}
				>
					No rules yet. Add a resource pattern above to start configuring.
				</p>
			) : (
				<table
					data-testid="grid-table"
					style={{
						width: "100%",
						borderCollapse: "separate",
						borderSpacing: "0 4px",
						fontFamily: "var(--mono, monospace)",
					}}
				>
					<thead>
						<tr>
							<th
								style={{
									textAlign: "left",
									padding: "0.25rem 0.4rem",
									color: "#7d8590",
									fontSize: "0.7rem",
									fontWeight: 600,
								}}
							>
								Resource
							</th>
							{SCOPES.map((scope) => (
								<th
									key={scope}
									style={{
										textAlign: "center",
										padding: "0.25rem 0.4rem",
										color: "#7d8590",
										fontSize: "0.7rem",
										fontWeight: 600,
										textTransform: "uppercase",
									}}
								>
									{scope}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{resources.map((resource) => (
							<tr key={resource} data-testid={`grid-row-${resource}`}>
								<td
									style={{
										padding: "0.25rem 0.4rem",
										fontSize: "0.75rem",
										color: "#e6edf3",
									}}
								>
									{resource}
								</td>
								{SCOPES.map((scope) => (
									<td
										key={scope}
										style={{ textAlign: "center", padding: "0.1rem 0.4rem" }}
									>
										<GridCell scope={scope} resource={resource} />
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			)}
		</section>
	);
}
