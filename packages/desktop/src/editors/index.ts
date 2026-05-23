/**
 * EditorHost contract + lifecycle helpers (T3.7 / G5.A.9).
 *
 * Apohara wraps multiple editor implementations (Monaco, Markdown,
 * CSV, etc.). Each one implements `EditorHost`. The `EditorRegistry`
 * maps file extensions to host factories; `createEditorLifecycle(host)`
 * gives consumers a small state machine (idle → mounted → closed) that
 * also tracks dirty status and exposes `save()`.
 *
 * The React side (`useEditorLifecycle`) is a thin hook that mirrors this
 * state machine into React state. The contract itself is vanilla TS so
 * it's testable without renderHook (consistent with the desktop test
 * style — see `packages/desktop/tests/unit/*`).
 */

export interface EditorHost {
  /** Mount the editor with the given initial document content. */
  mount(initial: string): Promise<void> | void;
  /** Tear down the editor (free Monaco/textarea resources, etc.). */
  unmount(): Promise<void> | void;
  /** Whether the in-memory document differs from the last persisted copy. */
  isDirty(): boolean;
  /** Persist the current document (writes to disk via Tauri / IPC). */
  save(): Promise<void> | void;
}

export type EditorHostFactory = () => EditorHost;

export class EditorRegistry {
  private readonly byExt = new Map<string, EditorHostFactory>();

  register(extensions: readonly string[], factory: EditorHostFactory): void {
    for (const ext of extensions) {
      this.byExt.set(ext.toLowerCase().replace(/^\./, ""), factory);
    }
  }

  factoryForExt(ext: string): EditorHostFactory | null {
    return this.byExt.get(ext.toLowerCase().replace(/^\./, "")) ?? null;
  }

  canHandle(path: string): boolean {
    return this.factoryForExt(extOf(path)) !== null;
  }
}

function extOf(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return "";
  return path.slice(dot + 1);
}

export function resolveEditorForPath(
  registry: EditorRegistry,
  path: string,
): EditorHost | null {
  const factory = registry.factoryForExt(extOf(path));
  return factory ? factory() : null;
}

export type EditorLifecycleState = "idle" | "mounted" | "closed";

export interface EditorLifecycle {
  state(): EditorLifecycleState;
  mount(initial: string): Promise<void>;
  unmount(): Promise<void>;
  save(): Promise<void>;
  isDirty(): boolean;
}

export function createEditorLifecycle(host: EditorHost): EditorLifecycle {
  let state: EditorLifecycleState = "idle";
  let cleanFlag = true;

  return {
    state: () => state,
    async mount(initial: string) {
      if (state === "mounted") return;
      await host.mount(initial);
      state = "mounted";
      cleanFlag = true;
    },
    async unmount() {
      if (state !== "mounted") {
        state = "closed";
        return;
      }
      await host.unmount();
      state = "closed";
    },
    async save() {
      if (state !== "mounted") {
        throw new Error("EditorLifecycle.save called before mount");
      }
      await host.save();
      cleanFlag = true;
    },
    isDirty(): boolean {
      if (state !== "mounted") return false;
      if (!cleanFlag) return true;
      if (host.isDirty()) {
        cleanFlag = false;
        return true;
      }
      return false;
    },
  };
}
