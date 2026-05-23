use super::json_patch_stream::*;
use serde_json::json;

#[test]
fn empty_diff_for_equal_values() {
    let v = json!({"a": 1, "b": [1, 2, 3]});
    assert!(diff_patch(&v, &v).is_empty());
}

#[test]
fn diff_emits_add_for_new_key() {
    let prev = json!({"a": 1});
    let next = json!({"a": 1, "b": 2});
    let ops = diff_patch(&prev, &next);
    assert_eq!(ops.len(), 1);
    assert_eq!(
        ops[0],
        JsonPatchOp::Add {
            path: "/b".to_string(),
            value: json!(2),
        }
    );
}

#[test]
fn diff_emits_remove_for_dropped_key() {
    let prev = json!({"a": 1, "b": 2});
    let next = json!({"a": 1});
    let ops = diff_patch(&prev, &next);
    assert_eq!(ops.len(), 1);
    assert_eq!(
        ops[0],
        JsonPatchOp::Remove {
            path: "/b".to_string(),
        }
    );
}

#[test]
fn diff_emits_replace_for_scalar_change() {
    let prev = json!({"a": 1});
    let next = json!({"a": 2});
    let ops = diff_patch(&prev, &next);
    assert_eq!(
        ops,
        vec![JsonPatchOp::Replace {
            path: "/a".to_string(),
            value: json!(2),
        }]
    );
}

#[test]
fn diff_recurses_into_nested_objects() {
    let prev = json!({"outer": {"inner": 1, "stable": "x"}});
    let next = json!({"outer": {"inner": 2, "stable": "x"}});
    let ops = diff_patch(&prev, &next);
    assert_eq!(
        ops,
        vec![JsonPatchOp::Replace {
            path: "/outer/inner".to_string(),
            value: json!(2),
        }]
    );
}

#[test]
fn diff_replaces_array_as_opaque() {
    // v1 design: arrays are diffed as a single replace, not per-element.
    let prev = json!({"xs": [1, 2, 3]});
    let next = json!({"xs": [1, 2, 4]});
    let ops = diff_patch(&prev, &next);
    assert_eq!(
        ops,
        vec![JsonPatchOp::Replace {
            path: "/xs".to_string(),
            value: json!([1, 2, 4]),
        }]
    );
}

#[test]
fn diff_replaces_when_type_changes_object_to_scalar() {
    let prev = json!({"a": {"x": 1}});
    let next = json!({"a": 5});
    let ops = diff_patch(&prev, &next);
    assert_eq!(
        ops,
        vec![JsonPatchOp::Replace {
            path: "/a".to_string(),
            value: json!(5),
        }]
    );
}

#[test]
fn rfc6901_escapes_tilde_and_slash_in_keys() {
    let prev = json!({});
    let next = json!({"a/b": 1, "c~d": 2});
    let ops = diff_patch(&prev, &next);
    // Both keys must be escaped per RFC 6901.
    let paths: Vec<&str> = ops
        .iter()
        .map(|o| match o {
            JsonPatchOp::Add { path, .. } => path.as_str(),
            _ => panic!("expected add"),
        })
        .collect();
    assert!(paths.contains(&"/a~1b"));
    assert!(paths.contains(&"/c~0d"));
}

#[test]
fn apply_add_inserts_at_path() {
    let doc = json!({"a": 1});
    let out = apply_patch(
        &doc,
        &[JsonPatchOp::Add {
            path: "/b".to_string(),
            value: json!(2),
        }],
    );
    assert_eq!(out, json!({"a": 1, "b": 2}));
    // Input must not be mutated.
    assert_eq!(doc, json!({"a": 1}));
}

#[test]
fn apply_replace_overwrites_existing() {
    let doc = json!({"a": 1});
    let out = apply_patch(
        &doc,
        &[JsonPatchOp::Replace {
            path: "/a".to_string(),
            value: json!(99),
        }],
    );
    assert_eq!(out, json!({"a": 99}));
}

#[test]
fn apply_remove_deletes_key() {
    let doc = json!({"a": 1, "b": 2});
    let out = apply_patch(
        &doc,
        &[JsonPatchOp::Remove {
            path: "/b".to_string(),
        }],
    );
    assert_eq!(out, json!({"a": 1}));
}

#[test]
fn apply_walks_nested_paths() {
    let doc = json!({"outer": {"inner": 1}});
    let out = apply_patch(
        &doc,
        &[JsonPatchOp::Replace {
            path: "/outer/inner".to_string(),
            value: json!(42),
        }],
    );
    assert_eq!(out, json!({"outer": {"inner": 42}}));
}

#[test]
fn apply_decodes_escaped_path_segments() {
    let doc = json!({});
    let out = apply_patch(
        &doc,
        &[JsonPatchOp::Add {
            path: "/a~1b".to_string(),
            value: json!(1),
        }],
    );
    assert_eq!(out, json!({"a/b": 1}));
}

#[test]
fn apply_ignores_root_target() {
    // RFC allows replacing root but our subset doesn't — mirrors TS.
    let doc = json!({"a": 1});
    let out = apply_patch(
        &doc,
        &[JsonPatchOp::Replace {
            path: String::new(),
            value: json!({"x": 2}),
        }],
    );
    assert_eq!(out, json!({"a": 1}));
}

#[test]
fn apply_silently_skips_missing_intermediate() {
    // TS returns early when walking through a non-object; verify parity.
    let doc = json!({"a": 1});
    let out = apply_patch(
        &doc,
        &[JsonPatchOp::Replace {
            path: "/missing/deep".to_string(),
            value: json!(1),
        }],
    );
    assert_eq!(out, json!({"a": 1}));
}

#[test]
fn diff_then_apply_is_identity() {
    let prev = json!({
        "tasks": {
            "t1": {"status": "pending", "providerId": "claude"},
            "t2": {"status": "completed", "result": "ok"}
        },
        "version": 7,
    });
    let next = json!({
        "tasks": {
            "t1": {"status": "completed", "providerId": "claude", "result": "ok"},
            "t3": {"status": "pending"}
        },
        "version": 8,
    });
    let patch = diff_patch(&prev, &next);
    assert_eq!(apply_patch(&prev, &patch), next);
}

#[test]
fn patch_op_round_trips_through_serde_with_ts_shape() {
    let op = JsonPatchOp::Add {
        path: "/a".to_string(),
        value: serde_json::json!(1),
    };
    let s = serde_json::to_string(&op).unwrap();
    // The TS shape uses {"op":"add","path":"...","value":...}.
    assert!(s.contains("\"op\":\"add\""));
    assert!(s.contains("\"path\":\"/a\""));
    let back: JsonPatchOp = serde_json::from_str(&s).unwrap();
    assert_eq!(back, op);

    let rem = JsonPatchOp::Remove {
        path: "/b".to_string(),
    };
    let s = serde_json::to_string(&rem).unwrap();
    assert!(s.contains("\"op\":\"remove\""));
    // No "value" field on remove.
    assert!(!s.contains("\"value\""));
    let back: JsonPatchOp = serde_json::from_str(&s).unwrap();
    assert_eq!(back, rem);
}
