/**
 * Centralized IPC listener registry per spec §0.1.
 *
 * RULE: React components NEVER subscribe to Tauri events directly. Listeners
 * registered here are subscribed ONCE at app boot, update Jotai/Zustand atoms,
 * and components read via useAtomValue().
 *
 * Without this: MaxListenersExceededWarning, race conditions on pane switch,
 * stale closures, double-fire on mount/unmount.
 */
import type { ListenerHandle, EventHandler } from "./types";
export type { ListenerHandle, EventHandler };

class ListenerRegistry {
  private handlers = new Map<string, Set<EventHandler>>();

  register<T = unknown>(event: string, handler: EventHandler<T>): ListenerHandle {
    if (typeof handler !== "function") {
      throw new Error(`Handler for ${event} must be a function`);
    }
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as EventHandler);
    return {
      dispose: () => {
        const s = this.handlers.get(event);
        if (s) {
          s.delete(handler as EventHandler);
          if (s.size === 0) this.handlers.delete(event);
        }
      },
    };
  }

  dispatch(event: string, payload: unknown): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      try { void handler(payload); } catch (e) {
        console.error(`Listener for ${event} threw:`, e);
      }
    }
  }

  reset(): void {
    this.handlers.clear();
  }
}

export const listenerRegistry = new ListenerRegistry();
