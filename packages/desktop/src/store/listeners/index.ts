/**
 * Centralized listener registration per spec §0.1.
 * registerAllListeners(deps) is called ONCE in App.tsx at boot.
 *
 * Each domain has its own register function; they all share a common
 * dispatcher interface (e.g., Tauri event bus or fetch-from-server).
 * For Stage 7 we abstract via an EventDispatcher interface; Stage 8
 * wires it to Tauri events + the orchestration DB.
 */
import { registerRunListeners } from "./runListeners.js";
import { registerTaskListeners } from "./taskListeners.js";
import { registerVerifierListeners } from "./verifierListeners.js";
import { registerHookListeners } from "./hookListeners.js";
import { registerPlanListeners } from "./planListeners.js";

export interface Store {
  get(ref: unknown): unknown;
  set(ref: unknown, value: unknown): void;
}

export interface EventSubscriber {
  on(event: string, handler: (payload: unknown) => void): void;
  off(event: string, handler: (payload: unknown) => void): void;
}

export interface ListenerDeps {
  store: Store;
  bus: EventSubscriber;
}

export interface RegistrationHandle {
  dispose(): void;
}

export function registerAllListeners(deps: ListenerDeps): RegistrationHandle {
  const disposers = [
    registerRunListeners(deps),
    registerTaskListeners(deps),
    registerVerifierListeners(deps),
    registerHookListeners(deps),
    registerPlanListeners(deps),
  ];
  return {
    dispose() {
      for (const d of disposers) d.dispose();
    },
  };
}