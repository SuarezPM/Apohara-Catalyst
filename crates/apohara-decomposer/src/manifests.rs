//! Manifest types + validation (port of `src/core/decomposer/manifests.ts`).
//!
//! Mirrors the TS shape per spec §3.3:
//!   - `SymbolRef` (file, symbol, kind)
//!   - `TaskSymbolManifest` (reads / writes / renames)
//!   - `RawTask` (id, description, dependsOn, agentRole, symbols)
//!
//! `parse_task_with_manifest` accepts arbitrary JSON and rejects anything
//! that does not match the schema — same error semantics as the TS
//! original so legacy callers crossing the bridge see identical messages.

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SymbolKind {
    Function,
    Class,
    Type,
    Module,
    Constant,
    Trait,
    Enum,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentRole {
    Planner,
    Coder,
    Critic,
    Judge,
    Explorer,
    Editor,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SymbolRef {
    pub file: String,
    pub symbol: String,
    pub kind: SymbolKind,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaskSymbolManifest {
    pub reads: Vec<SymbolRef>,
    pub writes: Vec<SymbolRef>,
    pub renames: Vec<SymbolRef>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawTask {
    pub id: String,
    pub description: String,
    pub depends_on: Vec<String>,
    pub agent_role: AgentRole,
    pub symbols: TaskSymbolManifest,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ManifestError {
    #[error("task must be object")]
    NotObject,
    #[error("task.id must be string")]
    BadId,
    #[error("task.description must be string")]
    BadDescription,
    #[error("task.dependsOn must be array")]
    BadDependsOn,
    #[error("task.agentRole must be string")]
    BadAgentRole,
    #[error("task.symbols: {0}")]
    BadSymbols(String),
}

/// Validate a `symbols` blob in isolation. Mirrors TS
/// `validateManifest` — checks the three array fields exist as arrays.
pub fn validate_manifest(symbols: &serde_json::Value) -> Result<(), String> {
    if !symbols.is_object() {
        return Err("symbols must be object".to_string());
    }
    for key in ["reads", "writes", "renames"] {
        let v = symbols.get(key);
        match v {
            Some(arr) if arr.is_array() => {}
            _ => return Err(format!("{key} must be array")),
        }
    }
    Ok(())
}

/// Parse + validate a task manifest from raw JSON. Field order mirrors
/// the TS `parseTaskWithManifest` so error messages match for any caller
/// that asserts on the string.
pub fn parse_task_with_manifest(raw: &serde_json::Value) -> Result<RawTask, ManifestError> {
    if !raw.is_object() {
        return Err(ManifestError::NotObject);
    }
    let obj = raw.as_object().unwrap();
    if !obj.get("id").map(|v| v.is_string()).unwrap_or(false) {
        return Err(ManifestError::BadId);
    }
    if !obj.get("description").map(|v| v.is_string()).unwrap_or(false) {
        return Err(ManifestError::BadDescription);
    }
    if !obj.get("dependsOn").map(|v| v.is_array()).unwrap_or(false) {
        return Err(ManifestError::BadDependsOn);
    }
    if !obj.get("agentRole").map(|v| v.is_string()).unwrap_or(false) {
        return Err(ManifestError::BadAgentRole);
    }
    let symbols = obj.get("symbols").cloned().unwrap_or(serde_json::Value::Null);
    validate_manifest(&symbols).map_err(ManifestError::BadSymbols)?;
    serde_json::from_value(raw.clone())
        .map_err(|e| ManifestError::BadSymbols(format!("serde: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn ok_task() -> serde_json::Value {
        json!({
            "id": "t1",
            "description": "build it",
            "dependsOn": [],
            "agentRole": "coder",
            "symbols": { "reads": [], "writes": [], "renames": [] }
        })
    }

    #[test]
    fn parses_valid_task() {
        let t = parse_task_with_manifest(&ok_task()).unwrap();
        assert_eq!(t.id, "t1");
        assert_eq!(t.agent_role, AgentRole::Coder);
        assert!(t.depends_on.is_empty());
    }

    #[test]
    fn rejects_non_object() {
        let err = parse_task_with_manifest(&json!("string")).unwrap_err();
        assert_eq!(err, ManifestError::NotObject);
    }

    #[test]
    fn rejects_missing_id() {
        let mut v = ok_task();
        v.as_object_mut().unwrap().remove("id");
        let err = parse_task_with_manifest(&v).unwrap_err();
        assert_eq!(err, ManifestError::BadId);
    }

    #[test]
    fn rejects_bad_description() {
        let mut v = ok_task();
        v["description"] = json!(42);
        let err = parse_task_with_manifest(&v).unwrap_err();
        assert_eq!(err, ManifestError::BadDescription);
    }

    #[test]
    fn rejects_non_array_depends_on() {
        let mut v = ok_task();
        v["dependsOn"] = json!("nope");
        let err = parse_task_with_manifest(&v).unwrap_err();
        assert_eq!(err, ManifestError::BadDependsOn);
    }

    #[test]
    fn rejects_missing_agent_role() {
        let mut v = ok_task();
        v.as_object_mut().unwrap().remove("agentRole");
        let err = parse_task_with_manifest(&v).unwrap_err();
        assert_eq!(err, ManifestError::BadAgentRole);
    }

    #[test]
    fn rejects_bad_symbols() {
        let mut v = ok_task();
        v["symbols"] = json!({ "reads": [], "writes": "x", "renames": [] });
        let err = parse_task_with_manifest(&v).unwrap_err();
        match err {
            ManifestError::BadSymbols(s) => assert!(s.contains("writes")),
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn validate_manifest_empty_arrays_ok() {
        let v = json!({ "reads": [], "writes": [], "renames": [] });
        validate_manifest(&v).unwrap();
    }

    #[test]
    fn validate_manifest_missing_renames_errors() {
        let v = json!({ "reads": [], "writes": [] });
        let e = validate_manifest(&v).unwrap_err();
        assert!(e.contains("renames"));
    }

    #[test]
    fn validate_manifest_non_object_errors() {
        let v = json!([1, 2]);
        let e = validate_manifest(&v).unwrap_err();
        assert!(e.contains("object"));
    }

    #[test]
    fn roundtrip_serde_camel_case_wire() {
        let t = RawTask {
            id: "x".into(),
            description: "d".into(),
            depends_on: vec!["y".into()],
            agent_role: AgentRole::Planner,
            symbols: TaskSymbolManifest::default(),
        };
        let json = serde_json::to_string(&t).unwrap();
        assert!(json.contains("\"dependsOn\""), "wire: {json}");
        assert!(json.contains("\"agentRole\""));
        let back: RawTask = serde_json::from_str(&json).unwrap();
        assert_eq!(back, t);
    }

    #[test]
    fn symbol_kind_serde_lowercase() {
        let kinds = [
            SymbolKind::Function,
            SymbolKind::Class,
            SymbolKind::Type,
            SymbolKind::Module,
            SymbolKind::Constant,
            SymbolKind::Trait,
            SymbolKind::Enum,
            SymbolKind::Other,
        ];
        for k in kinds {
            let s = serde_json::to_string(&k).unwrap();
            assert!(
                s == s.to_lowercase(),
                "kind {k:?} should serialize lowercase, got {s}"
            );
        }
    }
}
