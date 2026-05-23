/**
 * Per-step (per-message) usage attribution per spec §4.5 (nimbalyst #1.4).
 *
 * Each `sendMessage` round emits zero-or-more `usage` ProtocolEvents. This
 * tracker accumulates them per `sessionId` so the orchestration layer
 * (status-line, ledger, dashboard) can show cumulative + per-step breakdown.
 *
 * §0.14: absolutes > deltas. Each step stores the absolute step usage; the
 * cumulative is recomputed (sum) rather than diffed, so a missed event
 * doesn't drift the running total silently.
 */
import type { TokenUsage } from "./protocols/AgentProtocol";

export interface StepUsageEntry {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** Wall-clock time the step was recorded; ms since epoch. */
  recordedAt: number;
}

export interface CumulativeUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  stepCount: number;
}

export interface PricingPerMillion {
  inputPerMillion: number;
  outputPerMillion: number;
}

const ZERO: CumulativeUsage = {
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  stepCount: 0,
};

export class StepUsageTracker {
  private readonly bySession = new Map<string, StepUsageEntry[]>();

  /** Append one step's usage to the session log. */
  record(
    sessionId: string,
    step: Omit<StepUsageEntry, "recordedAt"> & { recordedAt?: number },
  ): void {
    const arr = this.bySession.get(sessionId) ?? [];
    arr.push({
      inputTokens: step.inputTokens,
      outputTokens: step.outputTokens,
      costUsd: step.costUsd,
      recordedAt: step.recordedAt ?? Date.now(),
    });
    this.bySession.set(sessionId, arr);
  }

  /**
   * Convenience: convert a TokenUsage + per-million pricing into a step
   * entry. Cost is computed as
   *   (inputTokens / 1_000_000) * inputPerMillion
   * + (outputTokens / 1_000_000) * outputPerMillion
   */
  recordFromUsage(
    sessionId: string,
    usage: TokenUsage,
    pricing: PricingPerMillion,
  ): void {
    const cost =
      (usage.inputTokens / 1_000_000) * pricing.inputPerMillion +
      (usage.outputTokens / 1_000_000) * pricing.outputPerMillion;
    this.record(sessionId, {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: cost,
    });
  }

  /** Read the full step log for a session (defensive copy). */
  steps(sessionId: string): readonly StepUsageEntry[] {
    return [...(this.bySession.get(sessionId) ?? [])];
  }

  /** Sum the steps for a session — recomputed each call (§0.14). */
  cumulative(sessionId: string): CumulativeUsage {
    const arr = this.bySession.get(sessionId);
    if (!arr || arr.length === 0) return { ...ZERO };
    let inputTokens = 0;
    let outputTokens = 0;
    let costUsd = 0;
    for (const s of arr) {
      inputTokens += s.inputTokens;
      outputTokens += s.outputTokens;
      costUsd += s.costUsd;
    }
    return { inputTokens, outputTokens, costUsd, stepCount: arr.length };
  }

  /** Clear all steps for a session. */
  reset(sessionId: string): void {
    this.bySession.delete(sessionId);
  }
}
