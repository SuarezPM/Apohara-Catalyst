import type { ListenerDeps, RegistrationHandle } from "./index.js";

export function registerRunListeners(deps: ListenerDeps): RegistrationHandle {
  const handler = (_payload: unknown) => {
    // Stage 8: write to runs atom
  };
  deps.bus.on("apohara://run-started", handler);
  return {
    dispose() {
      deps.bus.off("apohara://run-started", handler);
    },
  };
}