/**
 * Plan file watcher per spec §6.3.
 *
 * chokidar watches root/**\/*.md. On change/add/unlink:
 *   - invalidate the cache for the affected file
 *   - emit apohara://plan-changed / -added / -removed via listenerRegistry
 *
 * UI subscribes to those events to refresh PlansPanel.
 *
 * G5.G.2 (symphony #2) — Hot-reload with last-known-good fallback.
 * When `hotReloadValidate: true`, the watcher does an eager reparse on
 * every change/add event:
 *   - parse succeeds → cache is refreshed via `cache.clear()` so the
 *     next read repopulates it, and `apohara://plan-changed/-added`
 *     fires as before;
 *   - parse fails    → the cache entry is LEFT INTACT so consumers keep
 *     seeing the last-known-good plan, and `apohara://plan-invalid`
 *     fires with the parser error so the UI can flag the file. Without
 *     this, a half-saved edit (broken YAML) would evict the cached plan
 *     and break every consumer until the writer finished editing.
 */

import chokidar from "chokidar";
import { listenerRegistry } from "../../store/listeners";
import { parsePlanDocument } from "./planDocuments";
import type { PlanStatusCache } from "./planStatusCache";

export interface PlanWatcherOpts {
  rootPath: string;
  cache: PlanStatusCache;
  /** debounce window in ms (default 100) */
  debounceMs?: number;
  /**
   * If true, the watcher eagerly reparses on change/add and, when the
   * parse fails, leaves the previous cached plan in place
   * (last-known-good) and emits `apohara://plan-invalid` instead of
   * `apohara://plan-changed`.
   */
  hotReloadValidate?: boolean;
}

export interface PlanWatcherHandle {
  close(): Promise<void>;
}

export async function startPlanWatcher(opts: PlanWatcherOpts): Promise<PlanWatcherHandle> {
  const debounceMs = opts.debounceMs ?? 100;
  const validate = opts.hotReloadValidate === true;
  const watcher = chokidar.watch(opts.rootPath, {
    ignoreInitial: true,
    persistent: true,
    ignored: /(^|[\\/])\../,
    onlyFiles: true,
    awaitWriteFinish: { stabilityThreshold: debounceMs, pollInterval: 20 },
  });

  async function handleAddOrChange(filepath: string, kind: "added" | "changed"): Promise<void> {
    if (!filepath.endsWith(".md")) return;

    if (!validate) {
      opts.cache.clear(filepath);
      listenerRegistry.dispatch(`apohara://plan-${kind}`, { filepath });
      return;
    }

    // Validated hot-reload: try to parse the new content; on failure,
    // KEEP the existing cache entry so consumers see the last-known-good
    // plan, and fire `apohara://plan-invalid` instead.
    try {
      await parsePlanDocument(filepath);
      opts.cache.clear(filepath);
      listenerRegistry.dispatch(`apohara://plan-${kind}`, { filepath });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      // Intentionally NOT calling `cache.clear()` — the previous good
      // entry stays, and the next `getFast` resolves to it because the
      // mtime/size/sha keys for the prior content remain valid in the
      // cache.
      listenerRegistry.dispatch("apohara://plan-invalid", {
        filepath,
        error: errMsg,
      });
    }
  }

  watcher.on("add", (filepath) => {
    void handleAddOrChange(filepath, "added");
  });
  watcher.on("change", (filepath) => {
    void handleAddOrChange(filepath, "changed");
  });
  watcher.on("unlink", (filepath) => {
    if (!filepath.endsWith(".md")) return;
    opts.cache.clear(filepath);
    listenerRegistry.dispatch("apohara://plan-removed", { filepath });
  });

  await new Promise<void>(resolve => watcher.once("ready", resolve));

  return {
    async close(): Promise<void> { await watcher.close(); },
  };
}
