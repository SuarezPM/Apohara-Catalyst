//! JSONC (JSON with Comments) CST parser/serializer with comment preservation.
//!
//! The MCP bridge writes config files (`opencode.jsonc`, `.claude/settings.json`,
//! etc.) where the user may have hand-edited comments. Naïve serde_json
//! roundtrip destroys those comments — this CST keeps them.
//!
//! Spec v1.0 §0.27: "JSONC con preservación de comentarios via CST" — obligatorio.
//!
//! ## API notes (jsonc-parser 0.32)
//!
//! - `CstRootNode::parse` returns a CST that is `Clone`/`Display` — the root
//!   tracks its children through interior-mutable references, so editing
//!   operations are exposed via `&self` (not `&mut self`). That is why
//!   [`edit_value`] takes `&JsoncCst`, not `&mut JsoncCst`.
//! - `CstInputValue` does **not** implement `From<serde_json::Value>` in 0.32,
//!   so we convert manually via [`serde_to_cst`].

use jsonc_parser::cst::{CstInputValue, CstRootNode};

/// Public alias so callers do not depend on the upstream crate name directly.
pub type JsoncCst = CstRootNode;

/// Parses a JSONC source string into a CST that preserves every token
/// (comments, trailing commas, whitespace) for byte-identical roundtripping.
pub fn parse_jsonc(input: &str) -> Result<JsoncCst, String> {
    CstRootNode::parse(input, &Default::default()).map_err(|e| format!("jsonc parse: {e}"))
}

/// Replaces the value at `path` with `new_value` while leaving every other
/// token (comments, trailing commas, surrounding whitespace) untouched.
///
/// Panics if any path segment is missing or points at a non-object.
/// Returns silently when the leaf is replaced.
pub fn edit_value(cst: &JsoncCst, path: &[&str], new_value: serde_json::Value) {
    let mut current = cst
        .object_value()
        .expect("root node is not a JSON object");
    for (i, key) in path.iter().enumerate() {
        let prop = current
            .get(key)
            .unwrap_or_else(|| panic!("path[{i}]={key:?} not found"));
        if i == path.len() - 1 {
            prop.set_value(serde_to_cst(new_value));
            return;
        }
        current = prop
            .object_value()
            .unwrap_or_else(|| panic!("path[{i}]={key:?} is not an object"));
    }
}

/// Serializes the CST back to text. Byte-identical to the original input if
/// no edits were applied.
pub fn serialize_jsonc(cst: &JsoncCst) -> String {
    cst.to_string()
}

/// Converts a `serde_json::Value` to a `CstInputValue`.
///
/// The upstream crate does not provide a `From<serde_json::Value>` impl in
/// 0.32, but the leaf `From` impls for `bool`/`i64`/`f64`/`String`/`Vec`/
/// `Vec<(String, _)>` cover every JSON variant we need.
fn serde_to_cst(v: serde_json::Value) -> CstInputValue {
    match v {
        serde_json::Value::Null => CstInputValue::Null,
        serde_json::Value::Bool(b) => b.into(),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                i.into()
            } else if let Some(f) = n.as_f64() {
                f.into()
            } else {
                // u64 > i64::MAX falls through to f64 via serde_json; keep
                // a defensive fallback so the conversion never panics.
                0i64.into()
            }
        }
        serde_json::Value::String(s) => s.into(),
        serde_json::Value::Array(arr) => {
            let items: Vec<CstInputValue> = arr.into_iter().map(serde_to_cst).collect();
            items.into()
        }
        serde_json::Value::Object(map) => {
            let items: Vec<(String, CstInputValue)> =
                map.into_iter().map(|(k, v)| (k, serde_to_cst(v))).collect();
            items.into()
        }
    }
}
