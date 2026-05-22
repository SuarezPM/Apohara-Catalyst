import { atom } from "jotai/vanilla";

export type ViewMode = "graph" | "board";

const STORAGE_KEY = "apohara.viewMode";

function loadInitial(): ViewMode {
  if (typeof window === "undefined") return "graph";
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === "graph" || raw === "board") return raw;
  return "graph";
}

export const viewModeAtom = atom<ViewMode>(loadInitial());

export const setViewModeAtom = atom(null, (_get, set, next: ViewMode) => {
  set(viewModeAtom, next);
  if (typeof window !== "undefined") {
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
  }
});