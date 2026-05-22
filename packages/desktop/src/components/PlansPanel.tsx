import { useAtomValue, useSetAtom } from "jotai/react";
import { filteredPlansAtom, planFiltersAtom, type PlanSummary } from "../store/plansStore.js";

const STATUS_COLOR: Record<PlanSummary["status"], string> = {
  draft: "#6e7681",
  active: "#3fb950",
  paused: "#d29922",
  done: "#58a6ff",
};

const PRIORITY_BADGE: Record<NonNullable<PlanSummary["priority"]>, string> = {
  urgent: "🔥",
  high: "⚡",
  normal: "•",
  low: "·",
};

interface PlansPanelProps {
  onSelectPlan?(plan: PlanSummary): void;
}

export function PlansPanel({ onSelectPlan }: PlansPanelProps) {
  const plans = useAtomValue(filteredPlansAtom);
  const setFilters = useSetAtom(planFiltersAtom);

  return (
    <aside
      data-testid="plans-panel"
      style={{
        width: 320,
        background: "#0d1117",
        borderLeft: "1px solid #30363d",
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}
    >
      <header style={{ padding: "0.75rem", borderBottom: "1px solid #30363d", color: "#e6edf3", fontWeight: 600, fontSize: "0.85rem" }}>
        Plans ({plans.length})
      </header>
      <div style={{ padding: "0.5rem", borderBottom: "1px solid #30363d", display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
        <select
          data-testid="plans-filter-status"
          onChange={(e) => setFilters((f) => ({ ...f, status: (e.target.value || undefined) as PlanSummary["status"] | undefined }))}
          style={{ background: "#161b22", color: "#e6edf3", border: "1px solid #30363d", padding: "0.2rem", fontSize: "0.75rem" }}
          defaultValue=""
        >
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="done">Done</option>
        </select>
        <select
          data-testid="plans-filter-priority"
          onChange={(e) => setFilters((f) => ({ ...f, priority: (e.target.value || undefined) as PlanSummary["priority"] | undefined }))}
          style={{ background: "#161b22", color: "#e6edf3", border: "1px solid #30363d", padding: "0.2rem", fontSize: "0.75rem" }}
          defaultValue=""
        >
          <option value="">All priorities</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </select>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "0.5rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
        {plans.map((plan) => (
          <button
            key={plan.planId}
            data-testid={`plan-card-${plan.planId}`}
            onClick={() => onSelectPlan?.(plan)}
            style={{
              padding: "0.5rem",
              background: "#161b22",
              border: `1px solid ${STATUS_COLOR[plan.status]}33`,
              borderRadius: 4,
              cursor: "pointer",
              color: "#e6edf3",
              textAlign: "left",
              fontSize: "0.8rem",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.3rem", marginBottom: "0.3rem" }}>
              {plan.priority && <span>{PRIORITY_BADGE[plan.priority]}</span>}
              <span style={{ flex: 1, fontWeight: 600 }}>{plan.title}</span>
              <span style={{ color: STATUS_COLOR[plan.status], fontSize: "0.7rem" }}>{plan.status}</span>
            </div>
            {plan.tags && plan.tags.length > 0 && (
              <div style={{ display: "flex", gap: "0.2rem", flexWrap: "wrap", marginTop: "0.2rem" }}>
                {plan.tags.slice(0, 3).map((t) => (
                  <span key={t} style={{ fontSize: "0.65rem", color: "#8b949e", background: "#21262d", padding: "0.05rem 0.3rem", borderRadius: 2 }}>
                    {t}
                  </span>
                ))}
              </div>
            )}
            {plan.agentSessions.length > 0 && (
              <div style={{ fontSize: "0.7rem", color: "#6e7681", marginTop: "0.3rem" }}>
                {plan.agentSessions.length} session{plan.agentSessions.length !== 1 ? "s" : ""}
              </div>
            )}
            {plan.progress !== undefined && (
              <div style={{ marginTop: "0.3rem", height: 3, background: "#21262d", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ width: `${plan.progress}%`, height: "100%", background: STATUS_COLOR[plan.status] }} />
              </div>
            )}
          </button>
        ))}
        {plans.length === 0 && (
          <div style={{ color: "#6e7681", padding: "1rem", textAlign: "center", fontSize: "0.85rem" }}>
            No plans match the current filters.
          </div>
        )}
      </div>
    </aside>
  );
}