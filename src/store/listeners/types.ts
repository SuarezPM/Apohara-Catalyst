export interface ListenerHandle {
  dispose(): void;
}

export type EventHandler<T = unknown> = (payload: T) => void | Promise<void>;
