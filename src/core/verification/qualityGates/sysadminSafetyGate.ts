import type { GateInput, GateResult, QualityGate } from "./types";

const DANGEROUS_PATTERNS = [
  { re: /\brm\s+-rf\s+\/(?!\w)/, reason: "rm -rf / (root deletion)" },
  { re: /\b(iptables\s+-F|ufw\s+disable|firewall-cmd\s+--set-default-zone\s*=\s*trusted)\b/, reason: "firewall disable" },
  { re: /curl[^\n]*\|\s*sudo\s+(?:sh|bash)/, reason: "curl piped to sudo shell" },
  { re: /\bchmod\s+777\b/, reason: "world-writable chmod" },
  { re: /\bdd\s+if=\/dev\/(zero|random)\s+of=\/dev\/sd[a-z]\b/, reason: "raw disk write" },
];

export const sysadminSafetyGate: QualityGate = {
  name: "sysadmin_safety",
  appliesTo(_input) { return true; },
  evaluate(input) {
    for (const { re, reason } of DANGEROUS_PATTERNS) {
      if (re.test(input.diff) || re.test(input.output)) {
        return {
          kind: "block",
          reason: `Detected dangerous pattern: ${reason}`,
          feedbackToAgent: `The change includes '${reason}'. Confirm necessity, scope it narrowly (path, network, etc.), and explain rollback. Do NOT proceed silently.`,
        };
      }
    }
    return { kind: "pass" };
  },
};