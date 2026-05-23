import { createHash } from "node:crypto";

export interface TaskShape {
  prompt: string;
  provider: string;
  workspacePath: string;
}

export function computeTaskFingerprint(task: TaskShape): string {
  return createHash("sha256")
    .update(`${task.provider}|${task.workspacePath}|${task.prompt}`)
    .digest("hex");
}

export interface DuplicateGuardOptions {
  windowMs: number;
}

export class DuplicateGuard {
  private recent = new Map<string, number>();
  private windowMs: number;

  constructor(opts: DuplicateGuardOptions) {
    this.windowMs = opts.windowMs;
  }

  shouldAccept(task: TaskShape): boolean {
    const fp = computeTaskFingerprint(task);
    const now = Date.now();
    const last = this.recent.get(fp);
    if (last !== undefined && now - last < this.windowMs) {
      return false;
    }
    this.recent.set(fp, now);
    // Opportunistic GC: drop entries older than 10× window.
    const cutoff = now - this.windowMs * 10;
    for (const [k, t] of this.recent) {
      if (t < cutoff) this.recent.delete(k);
    }
    return true;
  }
}
