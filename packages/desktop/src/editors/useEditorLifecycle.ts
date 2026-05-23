/**
 * useEditorLifecycle React hook (T3.7 / G5.A.9).
 *
 * Thin wrapper around `createEditorLifecycle` that mirrors the lifecycle
 * state machine into React state. The hook owns the `EditorHost` instance
 * for the component's mount/unmount cycle so the host is always disposed
 * on unmount (`useEffect` cleanup) — even if the component throws.
 *
 * The vanilla state-machine is tested directly in
 * `packages/desktop/tests/unit/editor-host.test.ts`. This hook re-uses
 * that module verbatim so the contract drift is impossible.
 */
import { useEffect, useRef, useState } from "react";
import {
  createEditorLifecycle,
  type EditorHost,
  type EditorLifecycle,
  type EditorLifecycleState,
} from "./index.js";

export interface UseEditorLifecycleResult {
  state: EditorLifecycleState;
  isDirty: boolean;
  save: () => Promise<void>;
  lifecycle: EditorLifecycle | null;
}

export function useEditorLifecycle(
  host: EditorHost | null,
  initial: string,
): UseEditorLifecycleResult {
  const lifecycleRef = useRef<EditorLifecycle | null>(null);
  const [state, setState] = useState<EditorLifecycleState>("idle");
  const [isDirty, setIsDirty] = useState<boolean>(false);

  useEffect(() => {
    if (!host) return;
    const lc = createEditorLifecycle(host);
    lifecycleRef.current = lc;
    void lc.mount(initial).then(() => {
      setState(lc.state());
      setIsDirty(lc.isDirty());
    });

    // Poll dirty status — Monaco doesn't expose an isDirty event natively;
    // this is the same trick the spec-doc plan documents in T3.7.
    const interval = setInterval(() => {
      setIsDirty(lc.isDirty());
    }, 500);

    return () => {
      clearInterval(interval);
      void lc.unmount().then(() => setState("closed"));
      lifecycleRef.current = null;
    };
  }, [host, initial]);

  const save = async () => {
    const lc = lifecycleRef.current;
    if (!lc) return;
    await lc.save();
    setIsDirty(false);
  };

  return { state, isDirty, save, lifecycle: lifecycleRef.current };
}
