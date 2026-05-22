import type { GateInput, GateResult, QualityGate } from "./types";

export const codeQualityGate: QualityGate = {
  name: "code_quality",
  appliesTo(_input) { return true; },
  evaluate(input) {
    const findingCount = (input.output.match(/finding|issue|defect/gi) || []).length;
    const hasSeverity = /severity\s*[:=]\s*(low|medium|high|critical)/i.test(input.output);
    const hasRootCause = /root\s+cause/i.test(input.output);
    if (findingCount < 2 || !hasSeverity || !hasRootCause) {
      return {
        kind: "block",
        reason: `Code quality requires 2+ findings + severity + root cause (got ${findingCount} findings, severity=${hasSeverity}, root_cause=${hasRootCause})`,
        feedbackToAgent: "List at least 2 specific findings, assign severity to each, and articulate the root cause (not just symptoms).",
      };
    }
    return { kind: "pass" };
  },
};