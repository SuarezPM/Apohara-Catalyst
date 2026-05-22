/**
 * Centralized listeners for run lifecycle events.
 * Real handlers added in Stage 7 (UI) — this file exists so the import
 * path is reserved and tests can verify the registration pattern.
 */
import { listenerRegistry, type ListenerHandle } from "./index";

const handles: ListenerHandle[] = [];

export function registerRunListeners(): void {
  // Placeholder — Stage 7 wires this to actual atom mutations.
  handles.push(listenerRegistry.register("apohara://run-started", (_payload) => {
    // no-op for now
  }));
}

export function disposeRunListeners(): void {
  for (const h of handles) h.dispose();
  handles.length = 0;
}
