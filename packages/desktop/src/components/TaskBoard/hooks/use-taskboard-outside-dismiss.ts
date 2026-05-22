/**
 * Dismiss popovers/drawers on click outside the registered element.
 */
import { useEffect } from "react";

export function useOutsideDismiss(targetRef: React.RefObject<HTMLElement>, onDismiss: () => void, enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: MouseEvent) => {
      const target = targetRef.current;
      if (!target) return;
      if (e.target instanceof Node && !target.contains(e.target)) {
        onDismiss();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [targetRef, onDismiss, enabled]);
}