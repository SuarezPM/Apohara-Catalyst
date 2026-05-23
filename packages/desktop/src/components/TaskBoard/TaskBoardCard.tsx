import type { DagTask } from "../../store/dagStore.js";
import { AgentStateDot, type AgentState } from "../AgentStateDot.js";

interface TaskBoardCardProps {
  task: DagTask;
  onForceFail?: (id: string) => void;
}

const AGENT_ICON: Record<string, string> = {
  "claude-code-cli": "🤖",
  "codex-cli": "🧑‍💻",
  "opencode-go": "🚀",
};

function dotStateFor(status: string): AgentState {
  switch (status) {
    case "dispatched":
    case "in_verification":
      return "working";
    case "blocked":
    case "failed":
      return "error";
    case "done":
      return "done";
    case "ready":
    case "pending":
      return "idle";
    default:
      return "idle";
  }
}

function fmtDuration(ms?: number): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function fmtCost(usd?: number, tokensIn?: number, tokensOut?: number): string {
  if (!usd && !tokensIn) return "—";
  const parts: string[] = [];
  if (usd !== undefined) parts.push(`$${usd.toFixed(3)}`);
  if (tokensIn !== undefined && tokensOut !== undefined) parts.push(`${tokensIn + tokensOut}t`);
  return parts.join(" ");
}

export function TaskBoardCard({ task, onForceFail }: TaskBoardCardProps) {
  const icon = task.providerId ? AGENT_ICON[task.providerId] ?? "🔵" : "🔵";

  return (
    <div
      data-testid={`taskboard-card-${task.id}`}
      style={{
        padding: "0.6rem",
        background: "#0d1117",
        borderRadius: 4,
        border: "1px solid #30363d",
        fontSize: "0.85rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.3rem",
      }}
    >
      <header style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
        <AgentStateDot
          state={dotStateFor(task.status)}
          size="sm"
          label={`${task.id} ${task.status}`}
        />
        <span aria-label={task.providerId ?? "unknown"}>{icon}</span>
        <span style={{ fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {task.id}
        </span>
      </header>

      <div style={{ color: "#8b949e", fontSize: "0.75rem", lineHeight: 1.3 }}>{task.title}</div>

      {task.worktreeSlug && (
        <div data-testid={`worktree-slug-${task.id}`} style={{ color: "#58a6ff", fontSize: "0.7rem", fontFamily: "monospace" }}>
          {task.worktreeSlug}
        </div>
      )}

      <footer style={{ display: "flex", justifyContent: "space-between", color: "#6e7681", fontSize: "0.7rem", marginTop: "0.2rem" }}>
        <span>⏱ {fmtDuration(task.durationMs)}</span>
        <span>{fmtCost(task.costUsd, task.tokensIn, task.tokensOut)}</span>
      </footer>

      {task.status === "blocked" && task.blockedReason && (
        <div
          data-testid={`blocked-reason-${task.id}`}
          style={{
            marginTop: "0.3rem",
            padding: "0.3rem",
            background: "#a371f71a",
            border: "1px solid #a371f733",
            borderRadius: 3,
            color: "#a371f7",
            fontSize: "0.7rem",
          }}
        >
          {task.blockedReason}
          {task.waitingForTaskId && <> (waiting on {task.waitingForTaskId})</>}
          {task.overlapSymbols && task.overlapSymbols.length > 0 && (
            <div style={{ marginTop: "0.2rem", fontFamily: "monospace" }}>
              overlap: {task.overlapSymbols.slice(0, 3).join(", ")}
              {task.overlapSymbols.length > 3 && ` +${task.overlapSymbols.length - 3}`}
            </div>
          )}
        </div>
      )}

      {onForceFail && task.status === "dispatched" && (
        <button
          data-testid={`force-fail-${task.id}`}
          onClick={() => {
            if (confirm(`Force-fail ${task.id}? Worktree will be preserved.`)) {
              onForceFail(task.id);
            }
          }}
          style={{
            marginTop: "0.3rem",
            padding: "0.3rem",
            background: "transparent",
            border: "1px solid #f85149",
            color: "#f85149",
            borderRadius: 3,
            cursor: "pointer",
            fontSize: "0.7rem",
          }}
        >
          Force-fail
        </button>
      )}
    </div>
  );
}