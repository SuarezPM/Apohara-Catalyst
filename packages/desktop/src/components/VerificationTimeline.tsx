import { useAtomValue } from "jotai/react";
import { verificationAtom, ALL_STEPS, type StepStatus, type VerificationStep } from "../store/verificationStore.js";

const STATUS_ICON: Record<StepStatus, string> = {
  pending: "○",
  in_progress: "◐",
  done: "●",
  failed: "✕",
};

const STATUS_COLOR: Record<StepStatus, string> = {
  pending: "#6e7681",
  in_progress: "#d29922",
  done: "#3fb950",
  failed: "#f85149",
};

const STEP_LABEL: Record<VerificationStep, string> = {
  lock_acquired: "Lock acquired",
  agent_acted: "Agent acted",
  judge_scored: "Judge scored",
  critic_scored: "Critic scored",
  ledger_entry_hashed: "Ledger entry hashed",
};

export function VerificationTimeline() {
  const v = useAtomValue(verificationAtom);

  return (
    <div
      data-testid="verification-timeline"
      style={{
        padding: "0.5rem 0.75rem",
        background: "#161b22",
        border: "1px solid #30363d",
        borderRadius: 4,
        color: "#e6edf3",
        fontSize: "0.8rem",
      }}
    >
      <header style={{ color: "#8b949e", fontSize: "0.7rem", marginBottom: "0.5rem", textTransform: "uppercase" }}>
        Verification trail{v.taskId ? ` · ${v.taskId}` : ""}
      </header>
      <ol style={{ display: "flex", flexDirection: "column", gap: "0.2rem", margin: 0, padding: 0, listStyle: "none" }}>
        {ALL_STEPS.map((step) => {
          const status = v.steps[step];
          return (
            <li
              key={step}
              data-testid={`step-${step}`}
              data-status={status}
              style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: STATUS_COLOR[status] }}
            >
              <span style={{ fontFamily: "monospace", width: "1ch" }}>{STATUS_ICON[status]}</span>
              <span>{STEP_LABEL[step]}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}