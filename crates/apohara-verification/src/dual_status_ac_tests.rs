//! Tests for the dual-status AC tracker (ported from
//! `src/core/verification/dualStatusAC.ts`).

use crate::dual_status_ac::{AcSpec, AdminStatus, DevStatus, DualStatusAc};

fn fixture() -> DualStatusAc {
    DualStatusAc::new(AcSpec {
        id: "AC-1".to_string(),
        description: "Login flow returns 200 with valid creds".to_string(),
    })
}

#[test]
fn new_ac_starts_both_lanes_pending() {
    let ac = fixture();
    assert_eq!(ac.dev_status, DevStatus::Pending);
    assert_eq!(ac.admin_status, AdminStatus::Pending);
    assert!(!ac.is_fully_approved());
    assert!(!ac.is_rejected());
}

#[test]
fn fully_approved_requires_both_lanes() {
    let mut ac = fixture();
    ac.set_dev_status(DevStatus::Passed);
    assert!(!ac.is_fully_approved(), "dev alone is not enough");
    ac.set_admin_status(AdminStatus::Approved);
    assert!(ac.is_fully_approved(), "both lanes resolved → approved");
}

#[test]
fn rejected_if_dev_fails() {
    let mut ac = fixture();
    ac.set_dev_status(DevStatus::Failed);
    assert!(ac.is_rejected());
}

#[test]
fn rejected_if_admin_rejects() {
    let mut ac = fixture();
    ac.set_admin_status(AdminStatus::Rejected);
    assert!(ac.is_rejected());
}

#[test]
fn dev_passed_with_admin_pending_is_not_yet_approved() {
    let mut ac = fixture();
    ac.set_dev_status(DevStatus::Passed);
    assert!(!ac.is_fully_approved());
    assert!(!ac.is_rejected());
}

#[test]
fn ac_serializes_camel_case_keys() {
    let mut ac = fixture();
    ac.set_dev_status(DevStatus::Passed);
    let json = serde_json::to_string(&ac).unwrap();
    // Wire compat with TS interface: devStatus / adminStatus, snake_case enum values.
    assert!(json.contains("\"devStatus\":\"passed\""), "got: {json}");
    assert!(json.contains("\"adminStatus\":\"pending\""), "got: {json}");
    assert!(json.contains("\"id\":\"AC-1\""), "got: {json}");
}

#[test]
fn ac_roundtrip_serde() {
    let mut ac = fixture();
    ac.set_dev_status(DevStatus::Failed);
    ac.set_admin_status(AdminStatus::Rejected);
    let json = serde_json::to_string(&ac).unwrap();
    let back: DualStatusAc = serde_json::from_str(&json).unwrap();
    assert_eq!(back.dev_status, DevStatus::Failed);
    assert_eq!(back.admin_status, AdminStatus::Rejected);
    assert!(back.is_rejected());
}
