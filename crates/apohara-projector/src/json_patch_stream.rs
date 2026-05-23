//! JSON-Patch streaming per RFC 6902 (vibe-kanban #3 / G5.F.3).
//!
//! The dispatcher's SSE stream previously re-sent the entire projected
//! state on every tick. For long-lived sessions this becomes expensive:
//! O(taskCount) JSON serialization per event even when only one card
//! changed.
//!
//! This module computes a minimal patch between two snapshots and
//! provides an `apply_patch` that mirrors the spec exactly enough for
//! our needs: only `add`, `replace`, `remove` (no `move`, `copy`, `test`).
//!
//! Path encoding follows RFC 6901: `~` -> `~0`, `/` -> `~1`.
//!
//! v1 limitation: arrays are diffed as opaque values (no element-level
//! granularity). The TaskBoard projection uses an object shape at the
//! top level, so this is fine for the current consumers.
//!
//! Ported from `src/core/projector/json-patch-stream.ts`.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// A single JSON-Patch operation. Tagged on `op` so it round-trips with
/// the TS shape verbatim.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "lowercase")]
pub enum JsonPatchOp {
    Add { path: String, value: Value },
    Replace { path: String, value: Value },
    Remove { path: String },
}

/// Per RFC 6901 section 4 — escape `~` first, then `/`.
fn escape_token(t: &str) -> String {
    t.replace('~', "~0").replace('/', "~1")
}

fn unescape_token(t: &str) -> String {
    // Order matters: `~1` first then `~0`, mirroring the TS code which
    // reverses the escape sequence.
    t.replace("~1", "/").replace("~0", "~")
}

/// Compute a JSON-Patch that turns `prev` into `next`. Operates
/// recursively on JSON objects; arrays and scalars are diffed as whole
/// values (single `replace`).
pub fn diff_patch(prev: &Value, next: &Value) -> Vec<JsonPatchOp> {
    let mut ops = Vec::new();
    diff_patch_inner(prev, next, "", &mut ops);
    ops
}

fn diff_patch_inner(prev: &Value, next: &Value, base_path: &str, ops: &mut Vec<JsonPatchOp>) {
    if prev == next {
        return;
    }

    let (prev_obj, next_obj) = match (prev.as_object(), next.as_object()) {
        (Some(p), Some(n)) => (p, n),
        _ => {
            // Type mismatch or non-object on one side -> replace whole subtree.
            ops.push(JsonPatchOp::Replace {
                path: base_path.to_string(),
                value: next.clone(),
            });
            return;
        }
    };

    // Iterate next-keys first (preserves insertion order from serde_json
    // when preserve_order isn't enabled; either way semantics match TS
    // because we always emit add/replace before remove).
    for (key, nv) in next_obj.iter() {
        let path = format!("{}/{}", base_path, escape_token(key));
        match prev_obj.get(key) {
            None => ops.push(JsonPatchOp::Add {
                path,
                value: nv.clone(),
            }),
            Some(pv) if pv == nv => {}
            Some(pv) => match (pv.as_object(), nv.as_object()) {
                (Some(_), Some(_)) => diff_patch_inner(pv, nv, &path, ops),
                _ => ops.push(JsonPatchOp::Replace {
                    path,
                    value: nv.clone(),
                }),
            },
        }
    }

    for key in prev_obj.keys() {
        if next_obj.contains_key(key) {
            continue;
        }
        ops.push(JsonPatchOp::Remove {
            path: format!("{}/{}", base_path, escape_token(key)),
        });
    }
}

fn split_path(path: &str) -> Vec<String> {
    if path.is_empty() || path == "/" {
        return Vec::new();
    }
    // Skip the leading empty segment from the leading `/`.
    path.split('/').skip(1).map(unescape_token).collect()
}

/// Apply a JSON-Patch to a clone of `doc` and return the new document.
/// The input is never mutated.
pub fn apply_patch(doc: &Value, patch: &[JsonPatchOp]) -> Value {
    let mut next = doc.clone();
    for op in patch {
        apply_one(&mut next, op);
    }
    next
}

fn apply_one(root: &mut Value, op: &JsonPatchOp) {
    let path = match op {
        JsonPatchOp::Add { path, .. }
        | JsonPatchOp::Replace { path, .. }
        | JsonPatchOp::Remove { path } => path,
    };
    let parts = split_path(path);
    if parts.is_empty() {
        // Patching the root is undefined in our subset — skip (matches TS).
        return;
    }

    // Walk to the parent object.
    let (last, ancestors) = parts.split_last().expect("parts non-empty checked above");
    let mut cursor: &mut Value = root;
    for seg in ancestors {
        match cursor.as_object_mut() {
            Some(obj) => match obj.get_mut(seg) {
                Some(child) => cursor = child,
                None => return,
            },
            None => return,
        }
    }
    let parent: &mut Map<String, Value> = match cursor.as_object_mut() {
        Some(o) => o,
        None => return,
    };
    match op {
        JsonPatchOp::Add { value, .. } | JsonPatchOp::Replace { value, .. } => {
            parent.insert(last.clone(), value.clone());
        }
        JsonPatchOp::Remove { .. } => {
            parent.remove(last);
        }
    }
}
