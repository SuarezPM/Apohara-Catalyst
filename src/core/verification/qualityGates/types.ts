export type AgentRole = "planner" | "coder" | "critic" | "judge" | "explorer" | "editor";

export interface GateInput {
  taskRole: AgentRole;
  persona?: "backend" | "frontend" | "db" | "cloud" | "deployment" | "auth" | "crypto" | "perf";
  diff: string;
  output: string;
}

export type GateResult =
  | { kind: "pass" }
  | { kind: "block"; reason: string; feedbackToAgent: string };

export interface QualityGate {
  name: string;
  appliesTo(input: GateInput): boolean;
  evaluate(input: GateInput): GateResult;
}