//! Tests for JSONC CST roundtrip + targeted edits (spec v1.0 §0.27).

use crate::jsonc::{edit_value, parse_jsonc, serialize_jsonc};

#[test]
fn roundtrip_preserves_comments_and_trailing_commas() {
    let input = r#"{
    // User's preferred provider
    "provider": "claude-code-cli",
    /* Multi-line
       comment */
    "max_concurrent": 3, // trailing inline
    "experimental": {
        "smart_router": false, // off by default
    },
}"#;
    let cst = parse_jsonc(input).expect("parse");
    let out = serialize_jsonc(&cst);
    assert_eq!(out, input, "roundtrip must be byte-identical");
}

#[test]
fn editing_value_preserves_surrounding_comments() {
    let input = r#"{
    // important
    "provider": "claude-code-cli", // active
    "max_concurrent": 3,
}"#;
    let cst = parse_jsonc(input).expect("parse");
    edit_value(&cst, &["max_concurrent"], serde_json::json!(5));
    let out = serialize_jsonc(&cst);
    assert!(out.contains("// important"), "leading comment preserved");
    assert!(out.contains("// active"), "trailing inline comment preserved");
    assert!(
        out.contains(r#""max_concurrent": 5"#),
        "value changed; got:\n{out}"
    );
}

#[test]
fn editing_nested_value_preserves_comments() {
    let input = r#"{
    // top-level
    "provider": "claude-code-cli",
    "experimental": {
        // nested feature
        "smart_router": false, // off by default
    },
}"#;
    let cst = parse_jsonc(input).expect("parse");
    edit_value(&cst, &["experimental", "smart_router"], serde_json::json!(true));
    let out = serialize_jsonc(&cst);
    assert!(out.contains("// top-level"), "top-level comment preserved");
    assert!(out.contains("// nested feature"), "nested comment preserved");
    assert!(out.contains("// off by default"), "inline nested comment preserved");
    assert!(out.contains(r#""smart_router": true"#), "nested value changed");
}
