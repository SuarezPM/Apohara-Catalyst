//! Tests for `rfc2119` — mirror the TS validator suite.

use crate::rfc2119::{
    validate_rfc2119, Rfc2119Profile, Rfc2119Result, Rfc2119Severity,
};

fn run(body: &str) -> Rfc2119Result {
    validate_rfc2119(body, Rfc2119Profile::Strict)
}

#[test]
fn off_profile_short_circuits() {
    let r = validate_rfc2119("must should may", Rfc2119Profile::Off);
    assert_eq!(r.profile, Rfc2119Profile::Off);
    assert!(r.violations.is_empty());
}

#[test]
fn uppercase_keywords_are_not_violations() {
    let r = run("The runner MUST refuse. It SHOULD log. MAY retry once.");
    assert!(r.violations.is_empty(), "got: {:?}", r.violations);
}

#[test]
fn lowercase_must_is_error_in_strict() {
    let r = run("This must succeed.");
    assert_eq!(r.violations.len(), 1);
    let v = &r.violations[0];
    assert_eq!(v.keyword, "MUST");
    assert_eq!(v.matched_text, "must");
    assert_eq!(v.severity, Rfc2119Severity::Error);
    assert!(v.suggestion.contains("MUST"));
    assert_eq!(v.line, 1);
}

#[test]
fn two_word_form_wins_over_lone_word() {
    // "must not" should match as MUST NOT, not as MUST + (something).
    let r = run("This must not happen.");
    assert_eq!(r.violations.len(), 1);
    assert_eq!(r.violations[0].keyword, "MUST NOT");
    assert_eq!(r.violations[0].matched_text, "must not");
}

#[test]
fn lenient_downgrades_should_and_may_but_not_must() {
    let r = validate_rfc2119(
        "must succeed; should retry; may skip",
        Rfc2119Profile::Lenient,
    );
    let keywords: Vec<&str> = r.violations.iter().map(|v| v.keyword.as_str()).collect();
    assert!(keywords.contains(&"MUST"));
    assert!(keywords.contains(&"SHOULD"));
    assert!(keywords.contains(&"MAY"));
    let must = r.violations.iter().find(|v| v.keyword == "MUST").unwrap();
    let should = r.violations.iter().find(|v| v.keyword == "SHOULD").unwrap();
    let may = r.violations.iter().find(|v| v.keyword == "MAY").unwrap();
    assert_eq!(must.severity, Rfc2119Severity::Error);
    assert_eq!(should.severity, Rfc2119Severity::Warning);
    assert_eq!(may.severity, Rfc2119Severity::Warning);
}

#[test]
fn fenced_code_blocks_are_ignored() {
    let body = "Prose: must call.\n\
                ```\n\
                fn must_not() { /* must */ }\n\
                ```\n\
                More prose: should pass.";
    let r = run(body);
    // Two violations: the prose "must" on line 1, the prose "should" on line 5.
    assert_eq!(r.violations.len(), 2, "got: {:?}", r.violations);
    let kws: Vec<&str> = r.violations.iter().map(|v| v.keyword.as_str()).collect();
    assert_eq!(kws, vec!["MUST", "SHOULD"]);
    let lines: Vec<usize> = r.violations.iter().map(|v| v.line).collect();
    assert_eq!(lines, vec![1, 5]);
}

#[test]
fn inline_code_spans_are_ignored() {
    let r = run("Use the `must` flag — but the runner must succeed.");
    // The `must` inside backticks is masked; the prose "must" is flagged.
    assert_eq!(r.violations.len(), 1);
    assert_eq!(r.violations[0].keyword, "MUST");
}

#[test]
fn violations_sorted_by_line() {
    let body = "should one\nmust two\nmay three";
    let r = run(body);
    let lines: Vec<usize> = r.violations.iter().map(|v| v.line).collect();
    assert!(lines.windows(2).all(|w| w[0] <= w[1]), "lines: {lines:?}");
}

#[test]
fn crlf_line_endings_count_lines_correctly() {
    let body = "first line ok\r\nshould flag here\r\n";
    let r = run(body);
    assert_eq!(r.violations.len(), 1);
    assert_eq!(r.violations[0].line, 2);
}

#[test]
fn profile_serde_lowercase() {
    let s = serde_json::to_string(&Rfc2119Profile::Strict).unwrap();
    assert_eq!(s, "\"strict\"");
    let back: Rfc2119Profile = serde_json::from_str("\"lenient\"").unwrap();
    assert_eq!(back, Rfc2119Profile::Lenient);
}
