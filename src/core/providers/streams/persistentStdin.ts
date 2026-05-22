/**
 * Persistent prompt stream per spec §4.5 (nimbalyst #1.6 inspiration).
 *
 * The Claude SDK closes stdin on `type: "result"`, which breaks late
 * `can_use_tool` calls. This wrapper provides an infinite AsyncIterable
 * controlled by `controller.end(reason)` — the caller decides when stdin
 * is truly done, not the SDK.
 */

export type EndReason = "completed" | "aborted" | "interrupted";

export interface PromptStreamController<T> {
  writeMessage(msg: T): void;
  end(reason: EndReason): void;
}

export interface PersistentStream<T> {
  iter: AsyncIterable<T>;
  controller: PromptStreamController<T>;
}

export function createPersistentPromptStream<T>(): PersistentStream<T> {
  const queue: T[] = [];
  let resolveNext: ((v: IteratorResult<T>) => void) | null = null;
  let ended = false;
  let endReason: EndReason | null = null;

  const iter: AsyncIterable<T> = {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<T>> {
          if (queue.length > 0) {
            return { value: queue.shift()!, done: false };
          }
          if (ended) {
            return { value: undefined as unknown as T, done: true };
          }
          return new Promise<IteratorResult<T>>(r => { resolveNext = r; });
        },
      };
    },
  };

  const controller: PromptStreamController<T> = {
    writeMessage(msg) {
      if (ended) throw new Error(`stream ended (${endReason}); cannot write`);
      if (resolveNext) {
        const r = resolveNext; resolveNext = null;
        r({ value: msg, done: false });
      } else {
        queue.push(msg);
      }
    },
    end(reason) {
      if (ended) return;
      ended = true;
      endReason = reason;
      if (resolveNext) {
        const r = resolveNext; resolveNext = null;
        r({ value: undefined as unknown as T, done: true });
      }
    },
  };

  return { iter, controller };
}