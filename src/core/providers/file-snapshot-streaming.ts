/**
 * Streaming file snapshot diffs per spec §4.5 (nimbalyst #11.2).
 *
 * Builds on `snapshotDir` (G5.A.5): periodically rescans the workspace
 * and yields a `SnapshotDiff` per tick — but ONLY when at least one path
 * changed since the previous tick. The UI subscribes to this stream to
 * highlight "files touched by the running agent" without polling on every
 * frame.
 *
 * Caller controls lifecycle via `controller.stop()`. The iterator drains
 * cleanly and the underlying interval is cleared.
 */
import {
  diffSnapshots,
  snapshotDir,
  type DirSnapshot,
  type SnapshotDiff,
} from "./file-snapshot";

export interface SnapshotDiffStreamOpts {
  intervalMs: number;
}

export interface SnapshotDiffStream {
  iter: AsyncIterable<SnapshotDiff>;
  stop(): void;
}

export function streamSnapshotDiffs(
  root: string,
  initial: DirSnapshot,
  opts: SnapshotDiffStreamOpts,
): SnapshotDiffStream {
  let last: DirSnapshot = initial;
  let stopped = false;
  const queue: SnapshotDiff[] = [];
  let resolveNext: ((v: IteratorResult<SnapshotDiff>) => void) | null = null;

  const tick = async () => {
    if (stopped) return;
    try {
      const next = await snapshotDir(root);
      const d = diffSnapshots(last, next);
      last = next;
      if (d.added.length === 0 && d.modified.length === 0 && d.deleted.length === 0) {
        return;
      }
      if (resolveNext) {
        const r = resolveNext;
        resolveNext = null;
        r({ value: d, done: false });
      } else {
        queue.push(d);
      }
    } catch {
      // Snapshot failures are swallowed — the next tick will retry.
    }
  };

  const interval = setInterval(() => void tick(), opts.intervalMs);

  const iter: AsyncIterable<SnapshotDiff> = {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<SnapshotDiff>> {
          if (queue.length > 0) {
            return { value: queue.shift() as SnapshotDiff, done: false };
          }
          if (stopped) {
            return { value: undefined as unknown as SnapshotDiff, done: true };
          }
          return new Promise<IteratorResult<SnapshotDiff>>((r) => {
            resolveNext = r;
          });
        },
      };
    },
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(interval);
    if (resolveNext) {
      const r = resolveNext;
      resolveNext = null;
      r({ value: undefined as unknown as SnapshotDiff, done: true });
    }
  };

  return { iter, stop };
}
