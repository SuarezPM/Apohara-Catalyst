/**
 * Pointer-drag for TaskBoard cards per orca #15.
 * NO HTML5 DnD — uses native pointer events for full control.
 */
import { useCallback, useRef, useState } from "react";

export interface DragState {
  isDragging: boolean;
  dragTaskId: string | null;
  pointerX: number;
  pointerY: number;
}

export interface UsePointerDragOpts {
  onDrop?(taskId: string, targetLane: string): void;
}

export function usePointerDrag(opts: UsePointerDragOpts = {}) {
  const [state, setState] = useState<DragState>({ isDragging: false, dragTaskId: null, pointerX: 0, pointerY: 0 });
  const stateRef = useRef(state);
  stateRef.current = state;

  const startDrag = useCallback((taskId: string, e: PointerEvent | { clientX: number; clientY: number }) => {
    setState({ isDragging: true, dragTaskId: taskId, pointerX: e.clientX, pointerY: e.clientY });
  }, []);

  const updateDrag = useCallback((e: PointerEvent | { clientX: number; clientY: number }) => {
    setState((s) => s.isDragging ? { ...s, pointerX: e.clientX, pointerY: e.clientY } : s);
  }, []);

  const endDrag = useCallback((targetLane?: string) => {
    const current = stateRef.current;
    if (current.isDragging && current.dragTaskId && targetLane && opts.onDrop) {
      opts.onDrop(current.dragTaskId, targetLane);
    }
    setState({ isDragging: false, dragTaskId: null, pointerX: 0, pointerY: 0 });
  }, [opts]);

  const cancelDrag = useCallback(() => {
    setState({ isDragging: false, dragTaskId: null, pointerX: 0, pointerY: 0 });
  }, []);

  return { state, startDrag, updateDrag, endDrag, cancelDrag };
}