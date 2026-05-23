//! chorus H4 / T3.11 — Acceptance Criteria with TWO orthogonal states.
//!
//! Direct port of `src/core/verification/dualStatusAC.ts`.
//!
//!   `dev_status`   = automated / agent-driven (test passed, lint clean, etc.)
//!   `admin_status` = human admin approval (policy, business rules, etc.)
//!
//! Verification gate requires BOTH lanes to reach their "yes" state
//! before the AC is fully approved. The Rust port uses distinct enums
//! per lane so `set_dev_status(Approved)` and `set_admin_status(Failed)`
//! refuse to compile — the same compile-time discipline the TS file
//! enforces via narrow union types.

use serde::{Deserialize, Serialize};

/// Outcomes reachable in the dev lane (automated checks).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DevStatus {
    Pending,
    Passed,
    Failed,
}

/// Outcomes reachable in the admin lane (human approval).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AdminStatus {
    Pending,
    Approved,
    Rejected,
}

/// Union covering both lanes — kept for wire compat with the TS
/// `ACStatus` type. Useful for UI labels that don't care which lane
/// owns the status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AcStatus {
    Pending,
    Passed,
    Failed,
    Approved,
    Rejected,
}

/// Spec passed to [`DualStatusAc::new`]. Mirrors the TS `ACSpec`
/// interface (`id` + `description`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcSpec {
    pub id: String,
    pub description: String,
}

/// Acceptance criterion tracking both dev (automation) and admin
/// (human approval) lanes independently.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DualStatusAc {
    pub id: String,
    pub description: String,
    pub dev_status: DevStatus,
    pub admin_status: AdminStatus,
}

impl DualStatusAc {
    /// Build a new AC with both lanes in `Pending`.
    pub fn new(spec: AcSpec) -> Self {
        Self {
            id: spec.id,
            description: spec.description,
            dev_status: DevStatus::Pending,
            admin_status: AdminStatus::Pending,
        }
    }

    /// Update the automation lane. Only legal dev values are accepted
    /// by the type system (Pending / Passed / Failed).
    pub fn set_dev_status(&mut self, s: DevStatus) {
        self.dev_status = s;
    }

    /// Update the admin lane. Only legal admin values are accepted
    /// by the type system (Pending / Approved / Rejected).
    pub fn set_admin_status(&mut self, s: AdminStatus) {
        self.admin_status = s;
    }

    /// `true` ONLY when dev passed AND admin approved — matches the
    /// TS conjunction exactly.
    pub fn is_fully_approved(&self) -> bool {
        self.dev_status == DevStatus::Passed && self.admin_status == AdminStatus::Approved
    }

    /// `true` if EITHER lane rejected — matches TS disjunction.
    pub fn is_rejected(&self) -> bool {
        self.dev_status == DevStatus::Failed || self.admin_status == AdminStatus::Rejected
    }
}
