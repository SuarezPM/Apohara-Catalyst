/**
 * EventWriteQueue per spec §4.5 (nimbalyst #1.7 inspiration).
 *
 * Coalesces high-frequency events into batches to avoid starving awaited
 * writes (user prompts, permission audits). Idle window 200ms or 200 rows.
 * `enqueueAwaited` bypasses coalescing for user-critical writes.
 * Pressure logging: warn at depth > 500 or flush > 200ms.
 */

const DEFAULT_PRESSURE_DEPTH = 500;
const DEFAULT_PRESSURE_FLUSH_MS = 200;

export interface EventWriteQueueOptions<T> {
  idleFlushMs: number;
  thresholdRows: number;
  flush: (batch: T[]) => Promise<void>;
  pressureDepth?: number;
  pressureFlushMs?: number;
}

export class EventWriteQueue<T = unknown> {
  private queue: T[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private inflight: Promise<void> = Promise.resolve();

  constructor(private opts: EventWriteQueueOptions<T>) {}

  enqueue(event: T): void {
    this.queue.push(event);
    const depth = this.queue.length;
    const pressureDepth = this.opts.pressureDepth ?? DEFAULT_PRESSURE_DEPTH;
    if (depth > pressureDepth) {
      console.warn(`event_queue_pressure depth=${depth}`);
    }
    if (depth >= this.opts.thresholdRows) {
      void this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => void this.flush(), this.opts.idleFlushMs);
    }
  }

  async enqueueAwaited(event: T): Promise<void> {
    await this.opts.flush([event]);
  }

  private async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0);
    const t0 = Date.now();

    // `inflight` is the FIFO write chain. Without a `.catch` recovery,
    // one rejected flush would leave the chain in a permanently-rejected
    // state and every subsequent `await this.inflight` would re-throw —
    // silently losing every future write. We log the failure and
    // continue with a fresh resolved promise so the next enqueue tries
    // again on its own merits.
    const chained = this.inflight.then(async () => {
      try {
        await this.opts.flush(batch);
      } catch (err) {
        console.warn(
          `event_queue_flush_failed rows=${batch.length} err=${
            (err as Error).message
          }`,
        );
      }
      const dt = Date.now() - t0;
      const pressureFlushMs =
        this.opts.pressureFlushMs ?? DEFAULT_PRESSURE_FLUSH_MS;
      if (dt > pressureFlushMs) {
        console.warn(
          `event_queue_slow_flush ms=${dt} rows=${batch.length}`,
        );
      }
    });
    this.inflight = chained;
    await chained;
  }
}