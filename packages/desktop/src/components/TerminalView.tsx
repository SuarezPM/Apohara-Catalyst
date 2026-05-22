/**
 * TerminalView — Stage 7 PTY tab. Lists every active PTY in the
 * registry, lets the user open a fresh bash for hacking, and renders
 * the selected one inside a `TerminalPane`.
 *
 * Future polish (Stage 8): one tab per PTY in a header row, drag-to-
 * reorder, scrollback search, PTY-per-session correlation so the
 * panel auto-selects the PTY for the active run.
 */
import { useCallback, useEffect, useState } from "react";
import { TerminalPane } from "./TerminalPane.js";

interface PtyHandle {
	id: string;
	command: string;
	args: string[];
	cols: number;
	rows: number;
	startedAt: number;
	exitCode?: number;
	exitedAt?: number;
	pid: number;
}

async function listPtys(): Promise<PtyHandle[]> {
	const r = await fetch("/api/pty");
	if (!r.ok) return [];
	const body = (await r.json()) as { ptys: PtyHandle[] };
	return body.ptys ?? [];
}

async function spawnDevShell(): Promise<PtyHandle | null> {
	const shell = "bash";
	const r = await fetch("/api/pty", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ command: shell, args: ["-l"] }),
	});
	if (!r.ok) return null;
	return (await r.json()) as PtyHandle;
}

async function killPty(id: string): Promise<void> {
	await fetch(`/api/pty/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function TerminalView() {
	const [ptys, setPtys] = useState<PtyHandle[]>([]);
	const [selected, setSelected] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const refresh = useCallback(async () => {
		const list = await listPtys();
		setPtys(list);
		setSelected((prev) => {
			if (prev && list.some((p) => p.id === prev)) return prev;
			// Prefer a still-running PTY; otherwise the most recent.
			const running = list.find((p) => p.exitCode === undefined);
			return (running ?? list[list.length - 1])?.id ?? null;
		});
	}, []);

	useEffect(() => {
		refresh();
		const t = setInterval(refresh, 2000);
		return () => clearInterval(t);
	}, [refresh]);

	const handleSpawn = useCallback(async () => {
		if (busy) return;
		setBusy(true);
		try {
			const handle = await spawnDevShell();
			if (handle) {
				setPtys((prev) => [...prev, handle]);
				setSelected(handle.id);
			}
		} finally {
			setBusy(false);
		}
	}, [busy]);

	const handleKill = useCallback(
		async (id: string) => {
			await killPty(id);
			await refresh();
		},
		[refresh],
	);

	return (
		<div
			data-testid="terminal-view"
			style={{
				display: "flex",
				height: "100%",
				background: "#0c0c10",
				color: "#e6edf3",
			}}
		>
			{/* PTY list sidebar */}
			<aside
				style={{
					width: 240,
					borderRight: "1px solid #30363d",
					padding: "0.5rem",
					display: "flex",
					flexDirection: "column",
					gap: "0.4rem",
				}}
			>
				<header
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						color: "#8b949e",
						fontSize: "0.7rem",
						textTransform: "uppercase",
						letterSpacing: "0.05em",
					}}
				>
					PTYs ({ptys.length})
					<button
						type="button"
						onClick={handleSpawn}
						disabled={busy}
						style={{
							padding: "0.2rem 0.5rem",
							fontSize: "0.7rem",
							background: "#21262d",
							color: "#e6edf3",
							border: "1px solid #30363d",
							borderRadius: 3,
							cursor: busy ? "wait" : "pointer",
						}}
						title="Spawn an interactive bash for hacking"
					>
						+ bash
					</button>
				</header>
				{ptys.length === 0 ? (
					<div
						style={{
							color: "#6e7681",
							fontSize: "0.8rem",
							padding: "0.5rem 0",
						}}
					>
						No PTYs yet — click "+ bash" or run an agent.
					</div>
				) : (
					ptys.map((p) => {
						const isSel = p.id === selected;
						const exited = p.exitCode !== undefined;
						return (
							<div
								key={p.id}
								style={{
									display: "flex",
									alignItems: "center",
									gap: "0.3rem",
									padding: "0.35rem 0.5rem",
									borderRadius: 3,
									background: isSel ? "#30363d" : "transparent",
									cursor: "pointer",
									color: exited ? "#8b949e" : "#e6edf3",
									fontSize: "0.8rem",
								}}
								onClick={() => setSelected(p.id)}
							>
								<span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
									{exited ? "●" : "○"} {p.command} {p.args.join(" ")}
								</span>
								{exited ? (
									<span style={{ fontSize: "0.7rem", color: "#6e7681" }}>
										{p.exitCode === 0 ? "ok" : `x${p.exitCode}`}
									</span>
								) : (
									<button
										type="button"
										onClick={(e) => {
											e.stopPropagation();
											handleKill(p.id);
										}}
										style={{
											padding: "0 0.3rem",
											fontSize: "0.7rem",
											background: "transparent",
											color: "#f85149",
											border: "1px solid #30363d",
											borderRadius: 3,
											cursor: "pointer",
										}}
										title="Kill"
									>
										✕
									</button>
								)}
							</div>
						);
					})
				)}
			</aside>

			{/* Selected PTY panel */}
			<section style={{ flex: 1, minWidth: 0, position: "relative" }}>
				{selected ? (
					<TerminalPane key={selected} ptyId={selected} />
				) : (
					<div
						style={{
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							height: "100%",
							color: "#6e7681",
							fontSize: "0.85rem",
						}}
					>
						Select a PTY on the left, or spawn a new one.
					</div>
				)}
			</section>
		</div>
	);
}
