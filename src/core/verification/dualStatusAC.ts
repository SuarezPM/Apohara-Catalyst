/**
 * chorus H4 / T3.11 — Acceptance Criteria with TWO orthogonal states.
 *
 *   devStatus   = automated / agent-driven (test passed, lint clean, etc.)
 *   adminStatus = human admin approval (policy, business rules, etc.)
 *
 * Verification gate requires BOTH lanes to reach their "yes" state
 * before the AC is fully approved. This is the explicit separation
 * between "the code works" and "we are allowed to ship this change."
 *
 * The union `ACStatus` covers both lanes; each setter is restricted to
 * the legal subset for its lane so the type system refuses
 * `setDevStatus("approved")` (admin-only) or `setAdminStatus("failed")`
 * (dev-only) at compile time.
 */

export type ACStatus =
  | "pending"
  | "passed"
  | "failed"
  | "approved"
  | "rejected";

export type DevStatus = "pending" | "passed" | "failed";
export type AdminStatus = "pending" | "approved" | "rejected";

export interface ACSpec {
  id: string;
  description: string;
}

export class DualStatusAC {
  readonly id: string;
  readonly description: string;
  devStatus: DevStatus = "pending";
  adminStatus: AdminStatus = "pending";

  constructor(spec: ACSpec) {
    this.id = spec.id;
    this.description = spec.description;
  }

  setDevStatus(s: DevStatus): void {
    this.devStatus = s;
  }

  setAdminStatus(s: AdminStatus): void {
    this.adminStatus = s;
  }

  isFullyApproved(): boolean {
    return this.devStatus === "passed" && this.adminStatus === "approved";
  }

  isRejected(): boolean {
    return this.devStatus === "failed" || this.adminStatus === "rejected";
  }
}
