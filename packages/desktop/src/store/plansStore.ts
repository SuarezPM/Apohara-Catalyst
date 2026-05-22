/**
 * Plans store per spec §6.
 * Source of truth: TS-side PlanDocument from src/core/spec/planDocuments.ts.
 */
import { atom } from "jotai/vanilla";

export interface AgentSessionRef {
  sessionId: string;
  startedAt: number;
  endedAt?: number;
  outcome?: "success" | "failure" | "in_progress";
}

export interface PlanSummary {
  planId: string;
  filepath: string;
  title: string;
  status: "draft" | "active" | "paused" | "done";
  planType?: "feature" | "bug" | "refactor" | "research";
  priority?: "urgent" | "high" | "normal" | "low";
  owner?: string;
  tags?: string[];
  progress?: number;
  agentSessions: AgentSessionRef[];
}

export const plansAtom = atom<Record<string, PlanSummary>>({});

export interface PlanFilters {
  status?: PlanSummary["status"];
  priority?: PlanSummary["priority"];
  owner?: string;
  tag?: string;
}

export const planFiltersAtom = atom<PlanFilters>({});

export const filteredPlansAtom = atom((get) => {
  const plans = Object.values(get(plansAtom));
  const f = get(planFiltersAtom);
  return plans.filter((p) => {
    if (f.status && p.status !== f.status) return false;
    if (f.priority && p.priority !== f.priority) return false;
    if (f.owner && p.owner !== f.owner) return false;
    if (f.tag && !(p.tags ?? []).includes(f.tag)) return false;
    return true;
  });
});

export const upsertPlanAtom = atom(null, (get, set, plan: PlanSummary) => {
  const current = get(plansAtom);
  set(plansAtom, { ...current, [plan.planId]: plan });
});

export const removePlanAtom = atom(null, (get, set, planId: string) => {
  const current = get(plansAtom);
  if (!(planId in current)) return;
  const { [planId]: _, ...rest } = current;
  set(plansAtom, rest);
});