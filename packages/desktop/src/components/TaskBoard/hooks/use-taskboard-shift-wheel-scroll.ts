/**
 * Shift+wheel converts vertical wheel events to horizontal scroll
 * (kanban needs horizontal scroll for many columns) per orca #15.
 */
import { useCallback, useEffect } from "react";

export function useShiftWheelScroll(targetRef: React.RefObject<HTMLElement>) {
  const onWheel = useCallback((e: WheelEvent) => {
    if (!e.shiftKey || e.deltaY === 0) return;
    const target = targetRef.current;
    if (!target) return;
    e.preventDefault();
    target.scrollLeft += e.deltaY;
  }, [targetRef]);

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    target.addEventListener("wheel", onWheel, { passive: false });
    return () => target.removeEventListener("wheel", onWheel);
  }, [targetRef, onWheel]);
}