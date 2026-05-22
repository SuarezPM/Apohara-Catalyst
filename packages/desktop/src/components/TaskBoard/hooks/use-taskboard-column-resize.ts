/**
 * Column resize via right-edge handle drag per orca #15.
 * Persists widths to localStorage.
 */
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "apohara.taskboard.columnWidths";
const DEFAULT_WIDTH = 240;
const MIN_WIDTH = 120;
const MAX_WIDTH = 600;

export function useColumnResize(statusKeys: readonly string[]) {
  const [widths, setWidths] = useState<Record<string, number>>(() => {
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
      if (raw) return JSON.parse(raw);
    } catch {/* ignore */}
    const initial: Record<string, number> = {};
    for (const k of statusKeys) initial[k] = DEFAULT_WIDTH;
    return initial;
  });

  const setWidth = useCallback((key: string, width: number) => {
    const clamped = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width));
    setWidths((w) => ({ ...w, [key]: clamped }));
  }, []);

  useEffect(() => {
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
      }
    } catch {/* ignore */}
  }, [widths]);

  const reset = useCallback(() => {
    const initial: Record<string, number> = {};
    for (const k of statusKeys) initial[k] = DEFAULT_WIDTH;
    setWidths(initial);
  }, [statusKeys]);

  return { widths, setWidth, reset };
}

export { DEFAULT_WIDTH, MIN_WIDTH, MAX_WIDTH };