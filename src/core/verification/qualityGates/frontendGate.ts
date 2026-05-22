import type { GateInput, GateResult, QualityGate } from "./types";

export const frontendGate: QualityGate = {
  name: "frontend",
  appliesTo(input) { return input.persona === "frontend"; },
  evaluate(input) {
    const hasAria = /aria-|role\s*=/i.test(input.output);
    const hasViewport = /viewport|breakpoint|@media|responsive/i.test(input.output);
    if (!hasAria || !hasViewport) {
      return {
        kind: "block",
        reason: "Frontend output requires ARIA attribute mentions + viewport/breakpoint reasoning",
        feedbackToAgent: "Address accessibility via ARIA attributes/roles, and explain viewport/breakpoint behavior for the UI.",
      };
    }
    return { kind: "pass" };
  },
};