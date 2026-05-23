//! Tests for `plan_documents` — mirror the TS parser suite.

use crate::plan_documents::{
    parse_plan_document, parse_plan_document_str, PlanParseError, PlanPriority, PlanStatus,
    PlanType,
};
use std::path::Path;
use tempfile::TempDir;

const MIN_OK: &str = "---\n\
title: My Plan\n\
status: active\n\
---\n\
## Objective\n\
Ship it.\n";

#[test]
fn parses_minimum_valid_plan() {
    let p = parse_plan_document_str(Path::new("/tmp/x.md"), MIN_OK).unwrap();
    assert_eq!(p.title, "My Plan");
    assert_eq!(p.status, PlanStatus::Active);
    assert_eq!(p.objective, "Ship it.");
    assert!(p.acceptance_criteria.is_empty());
    assert!(p.out_of_scope.is_none());
    assert!(p.context.is_none());
}

#[test]
fn plan_id_is_sha1_of_path_plus_title_lowercase_hex() {
    let p1 = parse_plan_document_str(Path::new("/a.md"), MIN_OK).unwrap();
    let p2 = parse_plan_document_str(Path::new("/a.md"), MIN_OK).unwrap();
    let p3 = parse_plan_document_str(Path::new("/b.md"), MIN_OK).unwrap();
    assert_eq!(p1.plan_id, p2.plan_id, "deterministic for same input");
    assert_ne!(p1.plan_id, p3.plan_id, "different path → different id");
    assert_eq!(p1.plan_id.len(), 40);
    assert!(p1.plan_id.chars().all(|c| c.is_ascii_hexdigit()));
}

#[test]
fn missing_frontmatter_errors() {
    let body = "no frontmatter here";
    let err = parse_plan_document_str(Path::new("/x.md"), body).unwrap_err();
    assert!(matches!(err, PlanParseError::MissingFrontmatter(_)));
}

#[test]
fn unclosed_frontmatter_errors() {
    let body = "---\ntitle: x\nstatus: active\n";
    let err = parse_plan_document_str(Path::new("/x.md"), body).unwrap_err();
    assert!(matches!(err, PlanParseError::UnclosedFrontmatter(_)));
}

#[test]
fn missing_title_errors() {
    let body = "---\nstatus: active\n---\n## Objective\nfoo\n";
    let err = parse_plan_document_str(Path::new("/x.md"), body).unwrap_err();
    assert!(matches!(err, PlanParseError::MissingField { field: "title", .. }));
}

#[test]
fn invalid_status_errors() {
    let body = "---\ntitle: x\nstatus: bogus\n---\n## Objective\nfoo\n";
    let err = parse_plan_document_str(Path::new("/x.md"), body).unwrap_err();
    match err {
        PlanParseError::InvalidEnum { field, got, .. } => {
            assert_eq!(field, "status");
            assert_eq!(got, "bogus");
        }
        other => panic!("expected InvalidEnum, got {other:?}"),
    }
}

#[test]
fn missing_objective_errors() {
    let body = "---\ntitle: x\nstatus: active\n---\n## Context\nfoo\n";
    let err = parse_plan_document_str(Path::new("/x.md"), body).unwrap_err();
    assert!(matches!(
        err,
        PlanParseError::MissingSection { section: "Objective", .. }
    ));
}

#[test]
fn parses_optional_fields() {
    let body = "---\n\
title: My Plan\n\
status: paused\n\
planType: bug\n\
priority: high\n\
owner: pablo\n\
stakeholders:\n  - alice\n  - bob\n\
tags: [rust, port]\n\
created: 2026-05-23\n\
updated: 2026-05-24\n\
progress: 0.42\n\
---\n\
## Objective\nDo it.\n";
    let p = parse_plan_document_str(Path::new("/y.md"), body).unwrap();
    assert_eq!(p.status, PlanStatus::Paused);
    assert_eq!(p.plan_type, Some(PlanType::Bug));
    assert_eq!(p.priority, Some(PlanPriority::High));
    assert_eq!(p.owner.as_deref(), Some("pablo"));
    assert_eq!(p.stakeholders.as_deref(), Some(&["alice".to_string(), "bob".to_string()][..]));
    assert_eq!(p.tags.as_deref(), Some(&["rust".to_string(), "port".to_string()][..]));
    assert_eq!(p.created.as_deref(), Some("2026-05-23"));
    assert_eq!(p.progress, Some(0.42));
}

#[test]
fn parses_checklist_and_bullet_sections() {
    let body = "---\n\
title: Checklist Plan\n\
status: active\n\
---\n\
## Objective\nMain goal.\n\n\
## Acceptance Criteria\n\
- [ ] not done yet\n\
- [x] done\n\
- [X] also done\n\n\
## Out of Scope\n\
- nothing here\n\
- and this\n\n\
## Context\nbackground info\n";
    let p = parse_plan_document_str(Path::new("/z.md"), body).unwrap();
    assert_eq!(p.acceptance_criteria.len(), 3);
    assert!(!p.acceptance_criteria[0].checked);
    assert_eq!(p.acceptance_criteria[0].text, "not done yet");
    assert!(p.acceptance_criteria[1].checked);
    assert!(p.acceptance_criteria[2].checked);
    assert_eq!(
        p.out_of_scope.as_deref(),
        Some(&["nothing here".to_string(), "and this".to_string()][..])
    );
    assert_eq!(p.context.as_deref(), Some("background info"));
}

#[test]
fn invalid_plan_type_enum_errors() {
    let body = "---\n\
title: x\n\
status: active\n\
planType: invalid\n\
---\n\
## Objective\nfoo\n";
    let err = parse_plan_document_str(Path::new("/q.md"), body).unwrap_err();
    match err {
        PlanParseError::InvalidEnum { field, got, .. } => {
            assert_eq!(field, "planType");
            assert_eq!(got, "invalid");
        }
        other => panic!("expected InvalidEnum, got {other:?}"),
    }
}

#[tokio::test]
async fn parse_plan_document_reads_from_disk() {
    let tmp = TempDir::new().unwrap();
    let path = tmp.path().join("plan.md");
    tokio::fs::write(&path, MIN_OK).await.unwrap();
    let p = parse_plan_document(&path).await.unwrap();
    assert_eq!(p.title, "My Plan");
}

#[tokio::test]
async fn parse_plan_document_io_error_when_missing() {
    let tmp = TempDir::new().unwrap();
    let path = tmp.path().join("nope.md");
    let err = parse_plan_document(&path).await.unwrap_err();
    assert!(matches!(err, PlanParseError::Io { .. }));
}

#[test]
fn serde_emits_camelcase_keys() {
    let body = "---\ntitle: t\nstatus: draft\nplanType: refactor\n---\n## Objective\no\n";
    let p = parse_plan_document_str(Path::new("/c.md"), body).unwrap();
    let json = serde_json::to_string(&p).unwrap();
    assert!(json.contains("\"planId\""), "got: {json}");
    assert!(json.contains("\"planType\""), "got: {json}");
    assert!(json.contains("\"acceptanceCriteria\""), "got: {json}");
    assert!(json.contains("\"agentSessions\""), "got: {json}");
}
