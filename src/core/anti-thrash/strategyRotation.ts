/**
 * Strategy rotation anti-loop per spec §4.6.3.
 *
 * Tracks consecutive failures per tool kind. If threshold reached,
 * emits RotationAlert with additionalContext to inject into the agent's
 * next turn via hookSpecificOutput.additionalContext.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type ToolKind = "bash" | "edit" | "write" | "web" | "other";

export interface FailureCounts {
  bash_failures: number;
  edit_failures: number;
  write_failures: number;
  web_failures: number;
  last_failure_at: number;
}

export interface RotationAlert {
  triggered: boolean;
  tool: ToolKind;
  failure_count: number;
  additionalContext: string;
}

export class FailureTracker {
  private path: string;
  private threshold: number;
  private cached: FailureCounts | null = null;

  constructor(taskId: string, threshold: number = 2, basePath: string = tmpdir()) {
    this.path = join(basePath, `apohara-failures-${taskId}.json`);
    this.threshold = threshold;
  }

  private async load(): Promise<FailureCounts> {
    if (this.cached) return this.cached;
    try {
      const raw = await readFile(this.path, "utf-8");
      this.cached = JSON.parse(raw);
      return this.cached!;
    } catch {
      this.cached = { bash_failures: 0, edit_failures: 0, write_failures: 0, web_failures: 0, last_failure_at: 0 };
      return this.cached!;
    }
  }

  private async save(counts: FailureCounts): Promise<void> {
    this.cached = counts;
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(counts, null, 2));
  }

  private bumpFor(counts: FailureCounts, tool: ToolKind, delta: number): void {
    if (tool === "bash") counts.bash_failures += delta;
    else if (tool === "edit") counts.edit_failures += delta;
    else if (tool === "write") counts.write_failures += delta;
    else if (tool === "web") counts.web_failures += delta;
  }

  private getFor(counts: FailureCounts, tool: ToolKind): number {
    if (tool === "bash") return counts.bash_failures;
    if (tool === "edit") return counts.edit_failures;
    if (tool === "write") return counts.write_failures;
    if (tool === "web") return counts.web_failures;
    return 0;
  }

  async recordFailure(tool: ToolKind): Promise<RotationAlert> {
    const counts = await this.load();
    this.bumpFor(counts, tool, 1);
    counts.last_failure_at = Date.now();
    await this.save(counts);

    const failureCount = this.getFor(counts, tool);
    if (failureCount >= this.threshold) {
      return {
        triggered: true,
        tool,
        failure_count: failureCount,
        additionalContext: this.composeRotationDirective(tool, failureCount),
      };
    }
    return { triggered: false, tool, failure_count: failureCount, additionalContext: "" };
  }

  async recordSuccess(tool: ToolKind): Promise<void> {
    const counts = await this.load();
    if (this.getFor(counts, tool) === 0) return;
    if (tool === "bash") counts.bash_failures = 0;
    else if (tool === "edit") counts.edit_failures = 0;
    else if (tool === "write") counts.write_failures = 0;
    else if (tool === "web") counts.web_failures = 0;
    await this.save(counts);
  }

  async currentCounts(): Promise<FailureCounts> {
    return this.load();
  }

  private composeRotationDirective(tool: ToolKind, count: number): string {
    return `STRATEGY ROTATION ALERT: ${tool} tool has failed ${count} consecutive times. ` +
      `Stop and reflect: the current approach is not working. ` +
      `Consider: (a) read the related files first to understand the actual state, ` +
      `(b) try a different tool kind, ` +
      `(c) ask the coordinator if the task spec needs revision. ` +
      `Do NOT retry the same approach without changing something.`;
  }
}
