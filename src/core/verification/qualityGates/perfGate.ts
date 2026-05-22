import type { GateInput, GateResult, QualityGate } from "./types";

export const perfGate: QualityGate = {
  name: "perf",
  appliesTo(input) {
    return input.persona === "perf" || /performance|optimiz|latency|throughput/i.test(input.diff);
  },
  evaluate(input) {
    const hasMetric = /\b\d+\s*(ms|MB|req\/s|qps|GB|μs)\b/i.test(input.output);
    const hasBeforeAfter = /(before|baseline).*\b(after|now|optimized)\b/is.test(input.output);
    if (!hasMetric || !hasBeforeAfter) {
      return {
        kind: "block",
        reason: "Perf output requires concrete metrics (ms/MB/req/s) + before/after comparison",
        feedbackToAgent: "Include measured numbers (e.g. '450ms → 120ms', '50MB → 12MB') with explicit before/after framing.",
      };
    }
    return { kind: "pass" };
  },
};