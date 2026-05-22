import type { ListenerDeps, RegistrationHandle } from "./index.js";
import { upsertTaskAtom, type DagTask } from "../dagStore.js";

export function registerTaskListeners(deps: ListenerDeps): RegistrationHandle {
  const onCompleted = (payload: unknown) => {
    const p = payload as Partial<DagTask> & { id?: string };
    if (typeof p.id === "string") {
      deps.store.set(upsertTaskAtom, p as DagTask);
    }
  };
  deps.bus.on("apohara://task-completed", onCompleted);
  return {
    dispose() {
      deps.bus.off("apohara://task-completed", onCompleted);
    },
  };
}