import type { GateInput, GateResult, QualityGate } from "./types";

export const architectureGate: QualityGate = {
  name: "architecture",
  appliesTo(input) {
    return input.persona === "backend" || input.persona === "db" || input.persona === "cloud" || input.persona === "deployment";
  },
  evaluate(input) {
    const hasTradeoff = /trade-?off/i.test(input.output);
    const hasAlternatives = /alternatives?\s+considered/i.test(input.output);
    if (!hasTradeoff || !hasAlternatives) {
      return {
        kind: "block",
        reason: "Architecture output missing 'Trade-off' or 'Alternatives considered' section",
        feedbackToAgent: "Add a 'Trade-off' section explaining what you traded away and an 'Alternatives considered' section listing other approaches you evaluated.",
      };
    }
    return { kind: "pass" };
  },
};