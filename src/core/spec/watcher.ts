/**
 * Plan file watcher per spec §6.3.
 *
 * chokidar watches root/**\/*.md. On change/add/unlink:
 *   - invalidate the cache for the affected file
 *   - emit apohara://plan-changed / -added / -removed via listenerRegistry
 *
 * UI subscribes to those events to refresh PlansPanel.
 */

import chokidar from "chokidar";
import { listenerRegistry } from "../../store/listeners";
import type { PlanStatusCache } from "./planStatusCache";

export interface PlanWatcherOpts {
  rootPath: string;
  cache: PlanStatusCache;
  /** debounce window in ms (default 100) */
  debounceMs?: number;
}

export interface PlanWatcherHandle {
  close(): Promise<void>;
}

export async function startPlanWatcher(opts: PlanWatcherOpts): Promise<PlanWatcherHandle> {
  const debounceMs = opts.debounceMs ?? 100;
  const watcher = chokidar.watch(opts.rootPath, {
    ignoreInitial: true,
    persistent: true,
    ignored: /(^|[\\/])\../,
    onlyFiles: true,
    awaitWriteFinish: { stabilityThreshold: debounceMs, pollInterval: 20 },
  });

  watcher.on("add", (filepath) => {
    if (!filepath.endsWith(".md")) return;
    opts.cache.clear(filepath);
    listenerRegistry.dispatch("apohara://plan-added", { filepath });
  });
  watcher.on("change", (filepath) => {
    if (!filepath.endsWith(".md")) return;
    opts.cache.clear(filepath);
    listenerRegistry.dispatch("apohara://plan-changed", { filepath });
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