import { atom } from "jotai/vanilla";

/** Selected task id for drawer; null = closed */
export const selectedTaskIdAtom = atom<string | null>(null);

export const openDrawerAtom = atom(null, (_get, set, taskId: string) => set(selectedTaskIdAtom, taskId));
export const closeDrawerAtom = atom(null, (_get, set) => set(selectedTaskIdAtom, null));