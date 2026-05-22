import { architectureGate } from "./architectureGate";
import { securityGate } from "./securityGate";
import { perfGate } from "./perfGate";
import { codeQualityGate } from "./codeQualityGate";
import { frontendGate } from "./frontendGate";
import { sysadminSafetyGate } from "./sysadminSafetyGate";
import type { GateInput, GateResult, QualityGate } from "./types";

export const GATES: QualityGate[] = [
  architectureGate,
  securityGate,
  perfGate,
  codeQualityGate,
  frontendGate,
  sysadminSafetyGate,
];

export interface MultiGateResult {
  passes: string[];
  blocks: { gate: string; reason: string; feedbackToAgent: string }[];
}

export function runAllGates(input: GateInput): MultiGateResult {
  const passes: string[] = [];
  const blocks: { gate: string; reason: string; feedbackToAgent: string }[] = [];
  for (const gate of GATES) {
    if (!gate.appliesTo(input)) continue;
    const r = gate.evaluate(input);
    if (r.kind === "pass") passes.push(gate.name);
    else blocks.push({ gate: gate.name, reason: r.reason, feedbackToAgent: r.feedbackToAgent });
  }
  return { passes, blocks };
}

export type { QualityGate, GateInput, GateResult };