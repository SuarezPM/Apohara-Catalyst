import { DiffEditor } from "@monaco-editor/react";
import { useEffect, useMemo, useState } from "react";
import type { EventLog } from "../lib/types.js";

interface CodeDiffPaneProps {
	events: EventLog[];
}

interface FileSnapshot {
	path: string;
	status: "new" | "modified";
	before: string;
	after: string;
}

/**
 * Right pane — file tree + Monaco diff + verification mesh verdicts.
 *
 * Snapshots are reconstructed from the ledger:
 *   `file_created` -> { path, content }            -> snapshot { before: "", after: content }
 *   `file_modified` -> { path, before, after }     -> overrides or seeds the snapshot
 *
 * If `before`/`after` aren't in the payload (older events), the diff falls
 * back to "(content not in ledger)" placeholders. The first file with edits
 * is selected by default.
 */
export function CodeDiffPane({ events }: CodeDiffPaneProps) {
	const files = useMemo(() => collectFiles(events), [events]);
	const meshVerdicts = useMemo(
		() => events.filter((e) => e.type === "mesh_verdict"),
		[events],
	);
	const [selected, setSelected] = useState<string | null>(null);

	useEffect(() => {
		if (!selected && files.length > 0) {
			setSelected(files[0].path);
		}
	}, [files, selected]);

	const current = files.find((f) => f.path === selected) ?? null;

	return (
		<aside className="pane pane-code">
			<h2 className="pane-title">Code + Diff</h2>
			{files.length === 0 ? (
				<div className="empty">Modified files appear here</div>
			) : (
				<>
					<div className="file-tree">
						{files.map((f) => (
							<button
								key={f.path}
								type="button"
								className={`file-row mono${
									f.path === selected ? " active" : ""
								}`}
								onClick={() => setSelected(f.path)}
							>
								<span
									className={`file-status file-status-${
										f.status === "new" ? "new" : "mod"
									}`}
								>
									{f.status === "new" ? "+" : "~"}
								</span>
								<span className="file-path">{f.path}</span>
							</button>
						))}
					</div>
					<div className="diff-host">
						{current ? (
							<DiffEditor
								theme="vs-dark"
								original={current.before}
								modified={current.after}
								language={inferLanguage(current.path)}
								options={{
									readOnly: true,
									renderSideBySide: false,
									minimap: { enabled: false },
									scrollBeyondLastLine: false,
									fontFamily: "var(--font-mono)",
									fontSize: 12,
								}}
							/>
						) : null}
					</div>
				</>
			)}
			{meshVerdicts.length > 0 && (
				<div className="mesh-panel">
					<h3>Verification mesh</h3>
					<ul>
						{meshVerdicts.map((e) => (
							<li key={e.id} className="mono">
								{String(e.payload?.verdict ?? "—")}
								{typeof e.payload?.reason === "string"
									? ` — ${e.payload.reason}`
									: ""}
							</li>
						))}
					</ul>
				</div>
			)}
		</aside>
	);
}

function collectFiles(events: EventLog[]): FileSnapshot[] {
	const map = new Map<string, FileSnapshot>();
	for (const ev of events) {
		if (ev.type === "file_created") {
			const path =
				typeof ev.payload?.path === "string" ? ev.payload.path : null;
			if (!path) continue;
			const content =
				typeof ev.payload?.content === "string"
					? ev.payload.content
					: "(content not in ledger)";
			map.set(path, { path, status: "new", before: "", after: content });
		}
		if (ev.type === "file_modified") {
			const path =
				typeof ev.payload?.path === "string" ? ev.payload.path : null;
			if (!path) continue;
			const before =
				typeof ev.payload?.before === "string"
					? ev.payload.before
					: (map.get(path)?.after ?? "(content not in ledger)");
			const after =
				typeof ev.payload?.after === "string"
					? ev.payload.after
					: "(content not in ledger)";
			map.set(path, {
				path,
				status: map.get(path)?.status ?? "modified",
				before,
				after,
			});
		}
	}
	return [...map.values()];
}

function inferLanguage(path: string): string {
	const ext = path.split(".").pop()?.toLowerCase();
	switch (ext) {
		case "ts":
		case "tsx":
			return "typescript";
		case "js":
		case "jsx":
			return "javascript";
		case "rs":
			return "rust";
		case "py":
			return "python";
		case "json":
			return "json";
		case "md":
			return "markdown";
		case "css":
			return "css";
		case "html":
			return "html";
		case "go":
			return "go";
		case "yml":
		case "yaml":
			return "yaml";
		case "toml":
			return "ini";
		case "sh":
		case "bash":
			return "shell";
		default:
			return "plaintext";
	}
}
