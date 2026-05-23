//! Hook `additionalContext` response composition + verification.
//!
//! Mirrors `src/core/hooks/additional-context-response.ts` (G5.C.6).
//!
//! The hooks-server can return a JSON body shaped like:
//!
//! ```json
//! { "additionalContext": "...", "sources": ["compact", "warning"] }
//! ```
//!
//! The agent CLI reads this and prepends `additionalContext` to the next
//! `user_prompt_submit`. Composition is deterministic across three
//! producers: `compact`, `warning`, `learnings` (in that order). Each
//! non-empty source is joined with a double newline so internal markdown
//! structure is preserved.
//!
//! `verify_additional_context_response` enforces the wire contract: the
//! `additionalContext` field MUST be a string under 64 KiB (matches the
//! hooks-server's 256 KiB body cap with room for siblings).

use serde::{Deserialize, Serialize};

pub const ADDITIONAL_CONTEXT_LIMIT_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ComposeSources {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub compact: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub learnings: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ComposedResponse {
    #[serde(rename = "additionalContext")]
    pub additional_context: String,
    pub sources: Vec<String>,
}

/// Compose a deterministic response envelope. Empty / whitespace-only
/// sources are skipped. Ordering is fixed: compact > warning > learnings.
pub fn compose_additional_context_response(sources: &ComposeSources) -> ComposedResponse {
    let entries: [(&str, Option<&String>); 3] = [
        ("compact", sources.compact.as_ref()),
        ("warning", sources.warning.as_ref()),
        ("learnings", sources.learnings.as_ref()),
    ];
    let mut parts: Vec<String> = Vec::new();
    let mut used: Vec<String> = Vec::new();
    for (key, body) in entries {
        match body {
            Some(s) if !s.trim().is_empty() => {
                parts.push(s.clone());
                used.push(key.to_string());
            }
            _ => continue,
        }
    }
    ComposedResponse {
        additional_context: parts.join("\n\n"),
        sources: used,
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VerifyResult {
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl VerifyResult {
    fn ok() -> Self {
        Self {
            ok: true,
            error: None,
        }
    }
    fn err(msg: impl Into<String>) -> Self {
        Self {
            ok: false,
            error: Some(msg.into()),
        }
    }
}

/// Verify a raw response payload against the wire contract. Behaviour
/// mirrors the TS verifier: empty envelopes are ok, optional fields are
/// validated only when present.
pub fn verify_additional_context_response(payload: &serde_json::Value) -> VerifyResult {
    let obj = match payload.as_object() {
        Some(o) => o,
        None => return VerifyResult::err("payload must be an object"),
    };

    if let Some(v) = obj.get("additionalContext") {
        let s = match v.as_str() {
            Some(s) => s,
            None => return VerifyResult::err("additionalContext must be a string"),
        };
        let size = s.len();
        if size > ADDITIONAL_CONTEXT_LIMIT_BYTES {
            return VerifyResult::err(format!(
                "additionalContext exceeds 64 KiB cap ({size} bytes)"
            ));
        }
    }

    if let Some(v) = obj.get("sources") {
        let arr = match v.as_array() {
            Some(a) => a,
            None => return VerifyResult::err("sources must be an array of strings"),
        };
        if arr.iter().any(|x| !x.is_string()) {
            return VerifyResult::err("sources must be an array of strings");
        }
    }

    VerifyResult::ok()
}
