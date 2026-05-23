//! Mirrors `src/core/hooks/additional-context-response.test.ts`.

use super::additional_context::{
    compose_additional_context_response, verify_additional_context_response, ComposeSources,
    ADDITIONAL_CONTEXT_LIMIT_BYTES,
};
use serde_json::json;

#[test]
fn compose_returns_empty_when_no_sources() {
    let out = compose_additional_context_response(&ComposeSources::default());
    assert_eq!(out.additional_context, "");
    assert!(out.sources.is_empty());
}

#[test]
fn compose_joins_with_double_newline() {
    let out = compose_additional_context_response(&ComposeSources {
        compact: Some("compact body".into()),
        learnings: Some("learnings body".into()),
        warning: None,
    });
    assert_eq!(out.additional_context, "compact body\n\nlearnings body");
    assert!(out.sources.iter().any(|s| s == "compact"));
    assert!(out.sources.iter().any(|s| s == "learnings"));
}

#[test]
fn compose_skips_whitespace_only_sources() {
    let out = compose_additional_context_response(&ComposeSources {
        compact: Some("".into()),
        learnings: Some("   \n  ".into()),
        warning: Some("real content".into()),
    });
    assert_eq!(out.additional_context, "real content");
    assert_eq!(out.sources, vec!["warning".to_string()]);
}

#[test]
fn compose_respects_deterministic_order() {
    let out = compose_additional_context_response(&ComposeSources {
        learnings: Some("L".into()),
        warning: Some("W".into()),
        compact: Some("C".into()),
    });
    assert_eq!(out.additional_context, "C\n\nW\n\nL");
    assert_eq!(
        out.sources,
        vec!["compact".to_string(), "warning".into(), "learnings".into()]
    );
}

#[test]
fn compose_preserves_internal_newlines() {
    let out = compose_additional_context_response(&ComposeSources {
        compact: Some("line1\nline2".into()),
        warning: None,
        learnings: None,
    });
    assert_eq!(out.additional_context, "line1\nline2");
}

#[test]
fn verify_accepts_well_formed_envelope() {
    let res = verify_additional_context_response(&json!({ "additionalContext": "hello" }));
    assert!(res.ok);
}

#[test]
fn verify_accepts_empty_envelope() {
    let res = verify_additional_context_response(&json!({}));
    assert!(res.ok);
}

#[test]
fn verify_rejects_non_string_additional_context() {
    let res = verify_additional_context_response(&json!({ "additionalContext": 42 }));
    assert!(!res.ok);
    assert!(res.error.unwrap().contains("must be a string"));
}

#[test]
fn verify_rejects_oversize_additional_context() {
    let big = "a".repeat(ADDITIONAL_CONTEXT_LIMIT_BYTES + 1);
    let res = verify_additional_context_response(&json!({ "additionalContext": big }));
    assert!(!res.ok);
    assert!(res.error.unwrap().contains("64 KiB"));
}

#[test]
fn verify_accepts_exactly_64_kib() {
    let big = "a".repeat(ADDITIONAL_CONTEXT_LIMIT_BYTES);
    let res = verify_additional_context_response(&json!({ "additionalContext": big }));
    assert!(res.ok);
}

#[test]
fn verify_rejects_non_string_sources_elements() {
    let res = verify_additional_context_response(&json!({
        "additionalContext": "x",
        "sources": [1, 2]
    }));
    assert!(!res.ok);
}

#[test]
fn verify_accepts_valid_sources_array() {
    let res = verify_additional_context_response(&json!({
        "additionalContext": "x",
        "sources": ["compact"]
    }));
    assert!(res.ok);
}
