//! apohara.settings MCP server.
//!
//! Mirrors `src/core/mcp/servers/apohara-settings.ts` per spec §8.5.
//! Tools: get_setting / set_setting / list_settings.
//!
//! ALLOWLIST: ui.theme, ui.density, roster.preferred, cost.dailyBudget.
//! DENYLIST: providers.apiKeys, providers.oauth, github.appPrivateKey.
//!
//! KILL SWITCH: when APOHARA_MCP_SETTINGS_DISABLED=1 the constructor
//! returns None so the bootstrap doesn't even spin up the listener.
//!
//! Settings persist via atomic tmp+rename to a per-server JSON file.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tokio::sync::Mutex;

use crate::input_validation::require_string;
use crate::server::{tool_handler, McpError, ToolRegistration};

pub fn setting_allowlist() -> HashSet<&'static str> {
    [
        "ui.theme",
        "ui.density",
        "roster.preferred",
        "cost.dailyBudget",
    ]
    .into_iter()
    .collect()
}

pub fn setting_denylist() -> HashSet<&'static str> {
    [
        "providers.apiKeys",
        "providers.oauth",
        "github.appPrivateKey",
    ]
    .into_iter()
    .collect()
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct SettingsState {
    pub values: Map<String, Value>,
}

/// Returns true when the settings server should be skipped (env kill
/// switch). Pure so tests don't need env mutation.
pub fn is_settings_disabled(env_value: Option<&str>) -> bool {
    env_value == Some("1")
}

#[derive(Clone)]
pub struct SettingsStore {
    path: PathBuf,
    state: Arc<Mutex<SettingsState>>,
}

impl SettingsStore {
    pub async fn open(path: impl Into<PathBuf>) -> std::io::Result<Self> {
        let path = path.into();
        let state = load_state(&path).await?;
        Ok(Self {
            path,
            state: Arc::new(Mutex::new(state)),
        })
    }

    pub async fn get(&self, key: &str) -> Option<Value> {
        self.state.lock().await.values.get(key).cloned()
    }

    pub async fn set(&self, key: &str, value: Value) -> Result<(), std::io::Error> {
        let mut guard = self.state.lock().await;
        guard.values.insert(key.to_string(), value);
        atomic_write_json(&self.path, &guard).await
    }

    pub async fn list_visible(&self) -> Map<String, Value> {
        let deny = setting_denylist();
        let guard = self.state.lock().await;
        guard
            .values
            .iter()
            .filter(|(k, _)| !deny.contains(k.as_str()))
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect()
    }
}

async fn load_state(path: &Path) -> std::io::Result<SettingsState> {
    match tokio::fs::read_to_string(path).await {
        Ok(raw) => serde_json::from_str(&raw)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(SettingsState::default()),
        Err(e) => Err(e),
    }
}

async fn atomic_write_json(path: &Path, state: &SettingsState) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let tmp = tempfile::Builder::new()
        .prefix(".apohara-settings-")
        .tempfile_in(parent)?;
    let tmp_path = tmp.path().to_path_buf();
    let bytes = serde_json::to_vec_pretty(state)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    tokio::fs::write(&tmp_path, &bytes).await?;
    let (_keep, persisted) = tmp.keep().map_err(|e| e.error)?;
    tokio::fs::rename(&persisted, path).await
}

pub fn build_settings_tools(store: SettingsStore) -> Vec<ToolRegistration> {
    let allow = setting_allowlist();
    let deny = setting_denylist();
    let s1 = store.clone();
    let s2 = store.clone();
    let s3 = store;
    let deny1 = deny.clone();
    let deny2 = deny.clone();
    vec![
        ToolRegistration {
            name: "get_setting".to_string(),
            handler: tool_handler(move |input| {
                let store = s1.clone();
                let deny = deny1.clone();
                async move {
                    let key = require_string(&input, "key")?;
                    if deny.contains(key.as_str()) {
                        return Err(McpError::other(format!("denied: {key}")));
                    }
                    let value = store.get(&key).await.unwrap_or(Value::Null);
                    Ok(json!({ "key": key, "value": value }))
                }
            }),
        },
        ToolRegistration {
            name: "set_setting".to_string(),
            handler: tool_handler(move |input| {
                let store = s2.clone();
                let deny = deny2.clone();
                let allow = allow.clone();
                async move {
                    let key = require_string(&input, "key")?;
                    let value = input.get("value").cloned().unwrap_or(Value::Null);
                    if deny.contains(key.as_str()) {
                        return Err(McpError::other(format!("denied: {key}")));
                    }
                    if !allow.contains(key.as_str()) {
                        return Err(McpError::other(format!("not in allowlist: {key}")));
                    }
                    store
                        .set(&key, value.clone())
                        .await
                        .map_err(|e| McpError::other(e.to_string()))?;
                    Ok(json!({ "key": key, "value": value }))
                }
            }),
        },
        ToolRegistration {
            name: "list_settings".to_string(),
            handler: tool_handler(move |_input| {
                let store = s3.clone();
                async move {
                    let values = store.list_visible().await;
                    Ok(json!({ "values": values }))
                }
            }),
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn allow_and_deny_lists_are_disjoint() {
        let a = setting_allowlist();
        let d = setting_denylist();
        for k in &a {
            assert!(!d.contains(k), "{k} in both allow and deny");
        }
    }

    #[test]
    fn settings_disabled_only_for_one() {
        assert!(is_settings_disabled(Some("1")));
        assert!(!is_settings_disabled(Some("0")));
        assert!(!is_settings_disabled(None));
    }

    #[tokio::test]
    async fn set_setting_rejects_denylist() {
        let tmp = TempDir::new().unwrap();
        let store = SettingsStore::open(tmp.path().join("s.json"))
            .await
            .unwrap();
        let tools = build_settings_tools(store);
        let t = tools.iter().find(|t| t.name == "set_setting").unwrap();
        let mut input = Map::new();
        input.insert(
            "key".into(),
            Value::String("providers.apiKeys".into()),
        );
        input.insert("value".into(), Value::String("x".into()));
        let err = (t.handler)(input).await.unwrap_err();
        assert!(matches!(err, McpError::Other(_)));
    }

    #[tokio::test]
    async fn set_setting_rejects_outside_allowlist() {
        let tmp = TempDir::new().unwrap();
        let store = SettingsStore::open(tmp.path().join("s.json"))
            .await
            .unwrap();
        let tools = build_settings_tools(store);
        let t = tools.iter().find(|t| t.name == "set_setting").unwrap();
        let mut input = Map::new();
        input.insert("key".into(), Value::String("ui.color".into()));
        input.insert("value".into(), Value::String("blue".into()));
        let err = (t.handler)(input).await.unwrap_err();
        assert!(matches!(err, McpError::Other(_)));
    }

    #[tokio::test]
    async fn set_then_get_roundtrips_allowlisted_key() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("s.json");
        let store = SettingsStore::open(&path).await.unwrap();
        let tools = build_settings_tools(store);
        let setter = tools.iter().find(|t| t.name == "set_setting").unwrap();
        let getter = tools.iter().find(|t| t.name == "get_setting").unwrap();

        let mut input = Map::new();
        input.insert("key".into(), Value::String("ui.theme".into()));
        input.insert("value".into(), Value::String("dark".into()));
        (setter.handler)(input).await.unwrap();

        let mut get_input = Map::new();
        get_input.insert("key".into(), Value::String("ui.theme".into()));
        let out = (getter.handler)(get_input).await.unwrap();
        assert_eq!(out["value"], "dark");

        // Persistence: file on disk has the value.
        let raw = tokio::fs::read_to_string(&path).await.unwrap();
        let parsed: Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(parsed["values"]["ui.theme"], "dark");
    }

    #[tokio::test]
    async fn list_settings_hides_denylisted_keys() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("s.json");
        // Pre-seed file with a denylisted key smuggled in by another process.
        let mut state = SettingsState::default();
        state
            .values
            .insert("ui.theme".to_string(), Value::String("dark".into()));
        state.values.insert(
            "providers.apiKeys".to_string(),
            Value::String("leaked".into()),
        );
        tokio::fs::write(&path, serde_json::to_string(&state).unwrap())
            .await
            .unwrap();

        let store = SettingsStore::open(&path).await.unwrap();
        let tools = build_settings_tools(store);
        let lister = tools.iter().find(|t| t.name == "list_settings").unwrap();
        let out = (lister.handler)(Map::new()).await.unwrap();
        let values = out["values"].as_object().unwrap();
        assert!(values.contains_key("ui.theme"));
        assert!(!values.contains_key("providers.apiKeys"));
    }
}
