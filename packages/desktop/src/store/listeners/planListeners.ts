import type { ListenerDeps, RegistrationHandle } from "./index.js";
import { upsertPlanAtom, removePlanAtom, type PlanSummary } from "../plansStore.js";

export function registerPlanListeners(deps: ListenerDeps): RegistrationHandle {
  const onChanged = (payload: unknown) => {
    const p = payload as Partial<PlanSummary> & { planId?: string };
    if (typeof p.planId === "string") {
      deps.store.set(upsertPlanAtom, p as PlanSummary);
    }
  };
  const onRemoved = (payload: unknown) => {
    const p = payload as { planId?: string };
    if (typeof p.planId === "string") {
      deps.store.set(removePlanAtom, p.planId);
    }
  };
  deps.bus.on("apohara://plan-changed", onChanged);
  deps.bus.on("apohara://plan-added", onChanged);
  deps.bus.on("apohara://plan-removed", onRemoved);
  return {
    dispose() {
      deps.bus.off("apohara://plan-changed", onChanged);
      deps.bus.off("apohara://plan-added", onChanged);
      deps.bus.off("apohara://plan-removed", onRemoved);
    },
  };
}