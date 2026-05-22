/**
 * Rectangle area selection per orca #15. User drags an empty area to
 * create a selection rect; tasks intersecting the rect get selected.
 */
import { useCallback, useState } from "react";

export interface SelectionRect {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

export interface AreaSelectionState {
  rect: SelectionRect | null;
  selectedIds: Set<string>;
}

export function useAreaSelection() {
  const [state, setState] = useState<AreaSelectionState>({ rect: null, selectedIds: new Set() });

  const beginRect = useCallback((x: number, y: number) => {
    setState({ rect: { startX: x, startY: y, currentX: x, currentY: y }, selectedIds: new Set() });
  }, []);

  const updateRect = useCallback((x: number, y: number) => {
    setState((s) => s.rect ? { ...s, rect: { ...s.rect, currentX: x, currentY: y } } : s);
  }, []);

  const commitRect = useCallback((taskBounds: Map<string, DOMRect>) => {
    setState((s) => {
      if (!s.rect) return s;
      const selected = new Set<string>();
      const r = normalizeRect(s.rect);
      for (const [id, bounds] of taskBounds) {
        if (rectsIntersect(r, bounds)) selected.add(id);
      }
      return { rect: null, selectedIds: selected };
    });
  }, []);

  const clearSelection = useCallback(() => {
    setState({ rect: null, selectedIds: new Set() });
  }, []);

  return { state, beginRect, updateRect, commitRect, clearSelection };
}

export function normalizeRect(r: SelectionRect): { left: number; top: number; right: number; bottom: number } {
  return {
    left: Math.min(r.startX, r.currentX),
    top: Math.min(r.startY, r.currentY),
    right: Math.max(r.startX, r.currentX),
    bottom: Math.max(r.startY, r.currentY),
  };
}

export function rectsIntersect(a: { left: number; top: number; right: number; bottom: number }, b: { left: number; top: number; right: number; bottom: number }): boolean {
  return !(a.right < b.left || b.right < a.left || a.bottom < b.top || b.bottom < a.top);
}