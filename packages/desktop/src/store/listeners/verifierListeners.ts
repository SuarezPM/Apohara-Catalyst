import type { ListenerDeps, RegistrationHandle } from "./index.js";
import { setStepStatusAtom, type StepStatus } from "../verificationStore.js";

export function registerVerifierListeners(deps: ListenerDeps): RegistrationHandle {
  const onConflict = (payload: unknown) => {
    const p = payload as { step?: string; status?: StepStatus };
    if (p.step && p.status) {
      deps.store.set(setStepStatusAtom, { step: p.step, status: p.status });
    }
  };
  deps.bus.on("apohara://verifier-conflict", onConflict);
  return {
    dispose() {
      deps.bus.off("apohara://verifier-conflict", onConflict);
    },
  };
}