import { useAtomValue, useSetAtom } from "jotai/react";
import { selectedTaskIdAtom, closeDrawerAtom } from "../../store/drawerStore.js";
import { tasksAtom, type DagTask } from "../../store/dagStore.js";

interface HookEventStub { kind: string; toolName?: string; ts: number; }
interface VerdictStub { judge?: { score: number; }; critic?: { score: number; }; invariantsOk: boolean; }
interface LineageStub { parentTaskId?: string; lineageRoot?: string; depth: number; }

interface TaskBoardDrawerProps {
  hookEvents?: HookEventStub[];
  verdict?: VerdictStub;
  lineage?: LineageStub;
  worktreeInfo?: { path: string; branch: string; dirty: boolean; commitsAhead: number; commitsBehind: number; };
  onReplayLedger?: (taskId: string) => void;
}

export function TaskBoardDrawer(props: TaskBoardDrawerProps) {
  const selectedTaskId = useAtomValue(selectedTaskIdAtom);
  const tasks = useAtomValue(tasksAtom);
  const closeDrawer = useSetAtom(closeDrawerAtom);

  if (!selectedTaskId) return null;
  const task: DagTask | undefined = tasks[selectedTaskId];
  if (!task) return null;

  return (
    <aside
      data-testid="taskboard-drawer"
      style={{
        position: "fixed", right: 0, top: 0, bottom: 0, width: 440,
        background: "#0d1117", borderLeft: "1px solid #30363d", color: "#e6edf3",
        display: "flex", flexDirection: "column", zIndex: 1000,
      }}
    >
      <header style={{ padding: "0.75rem", borderBottom: "1px solid #30363d", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0, fontSize: "0.95rem" }}>{task.id}</h2>
        <button data-testid="drawer-close" onClick={() => closeDrawer()} style={{ background: "transparent", border: "none", color: "#8b949e", cursor: "pointer", fontSize: "1.2rem" }}>×</button>
      </header>

      <div style={{ overflowY: "auto", padding: "0.75rem", display: "flex", flexDirection: "column", gap: "1rem", fontSize: "0.8rem" }}>
        <section>
          <h3 style={{ fontSize: "0.75rem", color: "#8b949e", margin: "0 0 0.3rem" }}>SPEC</h3>
          <div>{task.title}</div>
          {task.agentRole && <div style={{ color: "#8b949e", fontSize: "0.7rem", marginTop: "0.2rem" }}>role: {task.agentRole}</div>}
        </section>

        {props.hookEvents && props.hookEvents.length > 0 && (
          <section data-testid="drawer-hook-events">
            <h3 style={{ fontSize: "0.75rem", color: "#8b949e", margin: "0 0 0.3rem" }}>HOOK EVENTS ({props.hookEvents.length})</h3>
            <div style={{ maxHeight: 180, overflowY: "auto", fontFamily: "monospace", fontSize: "0.7rem" }}>
              {props.hookEvents.map((e, idx) => (
                <div key={idx} style={{ padding: "0.15rem 0", borderBottom: "1px solid #21262d" }}>
                  {new Date(e.ts).toISOString().split("T")[1].slice(0, 8)} {e.kind} {e.toolName ?? ""}
                </div>
              ))}
            </div>
          </section>
        )}

        {props.verdict && (
          <section data-testid="drawer-verdict">
            <h3 style={{ fontSize: "0.75rem", color: "#8b949e", margin: "0 0 0.3rem" }}>VERIFICATION</h3>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              {props.verdict.judge && <span>judge: {props.verdict.judge.score.toFixed(2)}</span>}
              {props.verdict.critic && <span>critic: {props.verdict.critic.score.toFixed(2)}</span>}
              <span style={{ color: props.verdict.invariantsOk ? "#3fb950" : "#f85149" }}>
                INV-15: {props.verdict.invariantsOk ? "OK" : "FAILED"}
              </span>
            </div>
          </section>
        )}

        {task.status === "blocked" && (
          <section data-testid="drawer-blocked">
            <h3 style={{ fontSize: "0.75rem", color: "#8b949e", margin: "0 0 0.3rem" }}>DECISION GATE</h3>
            <div style={{ color: "#a371f7" }}>
              {task.blockedReason ?? "Blocked"}
              {task.waitingForTaskId && <div style={{ fontSize: "0.7rem", marginTop: "0.2rem" }}>waiting on {task.waitingForTaskId}</div>}
              {task.overlapSymbols && task.overlapSymbols.length > 0 && (
                <div style={{ fontFamily: "monospace", fontSize: "0.65rem", marginTop: "0.3rem", color: "#8b949e" }}>
                  overlap: {task.overlapSymbols.join(", ")}
                </div>
              )}
            </div>
          </section>
        )}

        {props.worktreeInfo && (
          <section data-testid="drawer-worktree">
            <h3 style={{ fontSize: "0.75rem", color: "#8b949e", margin: "0 0 0.3rem" }}>WORKTREE</h3>
            <div style={{ fontFamily: "monospace", fontSize: "0.7rem" }}>
              <div>{props.worktreeInfo.path}</div>
              <div style={{ color: "#58a6ff" }}>{props.worktreeInfo.branch}</div>
              <div style={{ color: "#8b949e", marginTop: "0.2rem" }}>
                {props.worktreeInfo.dirty ? "dirty" : "clean"} · ↑{props.worktreeInfo.commitsAhead} ↓{props.worktreeInfo.commitsBehind}
              </div>
            </div>
          </section>
        )}

        {props.lineage && (
          <section data-testid="drawer-lineage">
            <h3 style={{ fontSize: "0.75rem", color: "#8b949e", margin: "0 0 0.3rem" }}>LINEAGE</h3>
            <div style={{ fontSize: "0.7rem", fontFamily: "monospace" }}>
              depth: {props.lineage.depth}
              {props.lineage.parentTaskId && <div>parent: {props.lineage.parentTaskId}</div>}
              {props.lineage.lineageRoot && <div>root: {props.lineage.lineageRoot}</div>}
            </div>
          </section>
        )}

        {props.onReplayLedger && (
          <button
            data-testid="drawer-replay-ledger"
            onClick={() => props.onReplayLedger?.(task.id)}
            style={{ padding: "0.5rem", background: "#21262d", color: "#e6edf3", border: "1px solid #30363d", borderRadius: 4, cursor: "pointer", fontSize: "0.8rem" }}
          >
            Replay from ledger
          </button>
        )}
      </div>
    </aside>
  );
}