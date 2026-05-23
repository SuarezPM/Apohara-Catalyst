//! Lightweight runtime input validation for MCP tool handlers.
//!
//! Mirrors `src/core/mcp/base/inputValidation.ts`. Each helper rejects
//! malformed input BEFORE any FS / DB side-effect, returning a
//! `McpValidationError` that the HTTP layer maps to a 400 response.

use serde_json::{Map, Value};
use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
#[error("{0}")]
pub struct McpValidationError(pub String);

impl McpValidationError {
    pub fn new(msg: impl Into<String>) -> Self {
        Self(msg.into())
    }
}

pub type ValidationResult<T> = Result<T, McpValidationError>;

/// Require a non-empty string field. Matches TS `requireString` —
/// rejects missing, null, non-string, or empty string.
pub fn require_string(obj: &Map<String, Value>, key: &str) -> ValidationResult<String> {
    match obj.get(key) {
        Some(Value::String(s)) if !s.is_empty() => Ok(s.clone()),
        _ => Err(McpValidationError::new(format!("expected string '{key}'"))),
    }
}

/// Optional string — None if missing / null; error on wrong type.
pub fn optional_string(obj: &Map<String, Value>, key: &str) -> ValidationResult<Option<String>> {
    match obj.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => Ok(Some(s.clone())),
        _ => Err(McpValidationError::new(format!(
            "expected string '{key}' or omit"
        ))),
    }
}

/// Optional `Vec<String>`. None if missing; error if present but
/// not an array of strings.
pub fn optional_string_array(
    obj: &Map<String, Value>,
    key: &str,
) -> ValidationResult<Option<Vec<String>>> {
    match obj.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Array(arr)) => {
            let mut out = Vec::with_capacity(arr.len());
            for v in arr {
                match v {
                    Value::String(s) => out.push(s.clone()),
                    _ => {
                        return Err(McpValidationError::new(format!(
                            "expected string[] '{key}' or omit"
                        )))
                    }
                }
            }
            Ok(Some(out))
        }
        _ => Err(McpValidationError::new(format!(
            "expected string[] '{key}' or omit"
        ))),
    }
}

/// Optional integer with a default. Rejects non-integer / floating numbers.
pub fn optional_integer(
    obj: &Map<String, Value>,
    key: &str,
    default_value: Option<i64>,
) -> ValidationResult<Option<i64>> {
    match obj.get(key) {
        None | Some(Value::Null) => Ok(default_value),
        Some(Value::Number(n)) => {
            if let Some(i) = n.as_i64() {
                Ok(Some(i))
            } else {
                Err(McpValidationError::new(format!(
                    "expected integer '{key}' or omit"
                )))
            }
        }
        _ => Err(McpValidationError::new(format!(
            "expected integer '{key}' or omit"
        ))),
    }
}

/// Require a nested object. Rejects null, primitives, and arrays.
pub fn require_record<'a>(
    obj: &'a Map<String, Value>,
    key: &str,
) -> ValidationResult<&'a Map<String, Value>> {
    match obj.get(key) {
        Some(Value::Object(m)) => Ok(m),
        _ => Err(McpValidationError::new(format!("expected object '{key}'"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn obj(v: Value) -> Map<String, Value> {
        match v {
            Value::Object(m) => m,
            _ => panic!("test obj() requires Value::Object"),
        }
    }

    #[test]
    fn require_string_ok() {
        let m = obj(json!({"a": "hello"}));
        assert_eq!(require_string(&m, "a").unwrap(), "hello");
    }

    #[test]
    fn require_string_rejects_empty() {
        let m = obj(json!({"a": ""}));
        let err = require_string(&m, "a").unwrap_err();
        assert!(err.0.contains("expected string 'a'"));
    }

    #[test]
    fn require_string_rejects_missing() {
        let m = obj(json!({}));
        assert!(require_string(&m, "a").is_err());
    }

    #[test]
    fn require_string_rejects_non_string() {
        let m = obj(json!({"a": 42}));
        assert!(require_string(&m, "a").is_err());
    }

    #[test]
    fn optional_string_handles_missing_and_null() {
        let m = obj(json!({"a": null}));
        assert_eq!(optional_string(&m, "a").unwrap(), None);
        assert_eq!(optional_string(&m, "missing").unwrap(), None);
    }

    #[test]
    fn optional_string_rejects_wrong_type() {
        let m = obj(json!({"a": 1}));
        assert!(optional_string(&m, "a").is_err());
    }

    #[test]
    fn optional_string_array_ok() {
        let m = obj(json!({"a": ["x", "y"]}));
        assert_eq!(
            optional_string_array(&m, "a").unwrap(),
            Some(vec!["x".to_string(), "y".to_string()])
        );
    }

    #[test]
    fn optional_string_array_rejects_mixed() {
        let m = obj(json!({"a": ["x", 1]}));
        assert!(optional_string_array(&m, "a").is_err());
    }

    #[test]
    fn optional_integer_default_applied() {
        let m = obj(json!({}));
        assert_eq!(optional_integer(&m, "a", Some(10)).unwrap(), Some(10));
    }

    #[test]
    fn optional_integer_rejects_float() {
        let m = obj(json!({"a": 1.5}));
        assert!(optional_integer(&m, "a", None).is_err());
    }

    #[test]
    fn optional_integer_accepts_negative() {
        let m = obj(json!({"a": -7}));
        assert_eq!(optional_integer(&m, "a", None).unwrap(), Some(-7));
    }

    #[test]
    fn require_record_ok_only_for_object() {
        let m = obj(json!({"a": {"x": 1}}));
        assert!(require_record(&m, "a").is_ok());

        let m = obj(json!({"a": [1, 2]}));
        assert!(require_record(&m, "a").is_err());

        let m = obj(json!({"a": null}));
        assert!(require_record(&m, "a").is_err());
    }
}
