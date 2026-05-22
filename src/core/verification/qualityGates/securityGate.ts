import type { GateInput, GateResult, QualityGate } from "./types";

const OWASP = ["injection", "broken authentication", "xss", "csrf", "ssrf", "xxe", "deserialization", "logging", "monitoring", "access control"];

export const securityGate: QualityGate = {
  name: "security",
  appliesTo(input) {
    return input.persona === "auth" || input.persona === "crypto" ||
      /authentic|authoriz|input validation/i.test(input.diff);
  },
  evaluate(input) {
    const categoriesHit = OWASP.filter(c => new RegExp(c, "i").test(input.output));
    const hasSeverity = /severity\s*[:=]\s*(low|medium|high|critical)/i.test(input.output);
    const hasRemediation = /remediation\s*[:=]|how to fix/i.test(input.output);
    if (categoriesHit.length < 2 || !hasSeverity || !hasRemediation) {
      return {
        kind: "block",
        reason: `Security output requires 2+ OWASP categories + severity + remediation (got ${categoriesHit.length} categories, severity=${hasSeverity}, remediation=${hasRemediation})`,
        feedbackToAgent: "Reference at least 2 OWASP categories explicitly, assign a severity (low/medium/high/critical), and provide remediation steps per finding.",
      };
    }
    return { kind: "pass" };
  },
};