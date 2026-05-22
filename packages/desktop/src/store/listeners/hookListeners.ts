import type { ListenerDeps, RegistrationHandle } from "./index.js";

export function registerHookListeners(deps: ListenerDeps): RegistrationHandle {
  const onHook = (_payload: unknown) => {
    // Stage 8: append to a hookEvents atom keyed by task_id
  };
  deps.bus.on("apohara://hook-event", onHook);
  return {
    dispose() {
      deps.bus.off("apohara://hook-event", onHook);
    },
  };
}