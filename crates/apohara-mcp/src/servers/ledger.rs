//! apohara.ledger MCP server.
//!
//! Mirrors `src/core/mcp/servers/apohara-ledger.ts`. Exposes four
//! tools: read_events / replay_run / get_last_event / search_events.
//! Backed by a trait so this crate doesn't depend on the orchestration
//! db crate — the cli/desktop binary supplies a concrete adapter.

use std::sync::Arc;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::input_validation::{
    optional_integer, optional_string, optional_string_array, require_string,
};
use crate::server::{tool_handler, McpError, ToolRegistration};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LedgerEvent {
    pub id: i64,
    pub from_handle: Option<String>,
    pub to_handle: Option<String>,
    pub r#type: String,
    pub payload: String,
    pub ts: i64,
}

#[async_trait]
pub trait LedgerBackend: Send + Sync {
    /// Page through events. When `run_id` is None there's no thread
    /// filter; `types` is an OR filter; offset/limit paginate.
    async fn read_events(
        &self,
        run_id: Option<&str>,
        types: Option<&[String]>,
        offset: i64,
        limit: i64,
    ) -> Result<Vec<LedgerEvent>, String>;

    async fn replay_run(&self, run_id: &str) -> Result<Vec<LedgerEvent>, String>;

    async fn last_event(
        &self,
        run_id: &str,
        type_filter: &str,
    ) -> Result<Option<LedgerEvent>, String>;

    /// Substring search over payload, LIKE-wildcards escaped by the
    /// caller. Returns at most 100 matches.
    async fn search_events(
        &self,
        run_id: &str,
        substring: &str,
    ) -> Result<Vec<LedgerEvent>, String>;
}

pub fn build_ledger_tools(backend: Arc<dyn LedgerBackend>) -> Vec<ToolRegistration> {
    let b1 = Arc::clone(&backend);
    let b2 = Arc::clone(&backend);
    let b3 = Arc::clone(&backend);
    let b4 = Arc::clone(&backend);
    vec![
        ToolRegistration {
            name: "read_events".to_string(),
            handler: tool_handler(move |input| {
                let backend = Arc::clone(&b1);
                async move {
                    let run_id = optional_string(&input, "runId")?;
                    let types = optional_string_array(&input, "types")?;
                    let offset = optional_integer(&input, "offset", Some(0))?.unwrap_or(0);
                    let limit = optional_integer(&input, "limit", Some(100))?.unwrap_or(100);
                    let events = backend
                        .read_events(run_id.as_deref(), types.as_deref(), offset, limit)
                        .await
                        .map_err(McpError::other)?;
                    Ok(json!({ "events": events }))
                }
            }),
        },
        ToolRegistration {
            name: "replay_run".to_string(),
            handler: tool_handler(move |input| {
                let backend = Arc::clone(&b2);
                async move {
                    let run_id = require_string(&input, "runId")?;
                    let events = backend.replay_run(&run_id).await.map_err(McpError::other)?;
                    let total = events.len();
                    Ok(json!({
                        "run_id": run_id,
                        "events": events,
                        "total": total,
                    }))
                }
            }),
        },
        ToolRegistration {
            name: "get_last_event".to_string(),
            handler: tool_handler(move |input| {
                let backend = Arc::clone(&b3);
                async move {
                    let run_id = require_string(&input, "runId")?;
                    let type_filter = require_string(&input, "type")?;
                    let event = backend
                        .last_event(&run_id, &type_filter)
                        .await
                        .map_err(McpError::other)?;
                    Ok(json!({ "event": event }))
                }
            }),
        },
        ToolRegistration {
            name: "search_events".to_string(),
            handler: tool_handler(move |input| {
                let backend = Arc::clone(&b4);
                async move {
                    let run_id = require_string(&input, "runId")?;
                    let query = require_string(&input, "query")?;
                    let escaped = escape_like(&query);
                    let matches = backend
                        .search_events(&run_id, &escaped)
                        .await
                        .map_err(McpError::other)?;
                    Ok(json!({ "matches": matches }))
                }
            }),
        },
    ]
}

/// Escape `%` / `_` / `\` so a user-controlled query can only match
/// what they literally typed, not whatever-they-want via SQL LIKE
/// wildcards. ESCAPE clause in the backend's query makes `\` the
/// literal escape character.
pub fn escape_like(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        if matches!(c, '%' | '_' | '\\') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Map, Value};
    use std::sync::Mutex;

    struct StubBackend {
        events: Mutex<Vec<LedgerEvent>>,
    }

    impl StubBackend {
        fn new(events: Vec<LedgerEvent>) -> Self {
            Self {
                events: Mutex::new(events),
            }
        }
    }

    #[async_trait]
    impl LedgerBackend for StubBackend {
        async fn read_events(
            &self,
            _run_id: Option<&str>,
            types: Option<&[String]>,
            offset: i64,
            limit: i64,
        ) -> Result<Vec<LedgerEvent>, String> {
            let events = self.events.lock().unwrap();
            let filtered: Vec<LedgerEvent> = events
                .iter()
                .filter(|e| match types {
                    Some(t) => t.iter().any(|x| x == &e.r#type),
                    None => true,
                })
                .skip(offset as usize)
                .take(limit as usize)
                .cloned()
                .collect();
            Ok(filtered)
        }

        async fn replay_run(&self, _run_id: &str) -> Result<Vec<LedgerEvent>, String> {
            Ok(self.events.lock().unwrap().clone())
        }

        async fn last_event(
            &self,
            _run_id: &str,
            type_filter: &str,
        ) -> Result<Option<LedgerEvent>, String> {
            Ok(self
                .events
                .lock()
                .unwrap()
                .iter()
                .rev()
                .find(|e| e.r#type == type_filter)
                .cloned())
        }

        async fn search_events(
            &self,
            _run_id: &str,
            substring: &str,
        ) -> Result<Vec<LedgerEvent>, String> {
            Ok(self
                .events
                .lock()
                .unwrap()
                .iter()
                .filter(|e| e.payload.contains(substring))
                .cloned()
                .collect())
        }
    }

    fn ev(id: i64, ty: &str, payload: &str) -> LedgerEvent {
        LedgerEvent {
            id,
            from_handle: Some("a".to_string()),
            to_handle: Some("b".to_string()),
            r#type: ty.to_string(),
            payload: payload.to_string(),
            ts: id * 1000,
        }
    }

    #[tokio::test]
    async fn replay_run_returns_event_count() {
        let backend = Arc::new(StubBackend::new(vec![
            ev(1, "x", "p"),
            ev(2, "y", "q"),
        ]));
        let tools = build_ledger_tools(backend);
        let replay = tools.iter().find(|t| t.name == "replay_run").unwrap();
        let mut input = Map::new();
        input.insert("runId".into(), Value::String("r1".into()));
        let out = (replay.handler)(input).await.unwrap();
        assert_eq!(out["total"], 2);
        assert_eq!(out["run_id"], "r1");
    }

    #[tokio::test]
    async fn read_events_rejects_missing_when_required_args_off() {
        // read_events allows no runId — should return all events
        let backend = Arc::new(StubBackend::new(vec![ev(1, "x", "p")]));
        let tools = build_ledger_tools(backend);
        let read = tools.iter().find(|t| t.name == "read_events").unwrap();
        let out = (read.handler)(Map::new()).await.unwrap();
        assert_eq!(out["events"].as_array().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn get_last_event_requires_runid_and_type() {
        let backend = Arc::new(StubBackend::new(vec![]));
        let tools = build_ledger_tools(backend);
        let last = tools.iter().find(|t| t.name == "get_last_event").unwrap();
        let err = (last.handler)(Map::new()).await.unwrap_err();
        assert!(matches!(err, McpError::Validation(_)));
    }

    #[tokio::test]
    async fn search_events_forwards_escaped_query_to_backend() {
        // Record what the backend was asked for so we can prove the
        // tool passed the escaped substring (the real SQLite layer is
        // configured with ESCAPE '\\').
        struct Recording {
            last: Mutex<Option<String>>,
        }
        #[async_trait]
        impl LedgerBackend for Recording {
            async fn read_events(
                &self,
                _: Option<&str>,
                _: Option<&[String]>,
                _: i64,
                _: i64,
            ) -> Result<Vec<LedgerEvent>, String> {
                Ok(vec![])
            }
            async fn replay_run(&self, _: &str) -> Result<Vec<LedgerEvent>, String> {
                Ok(vec![])
            }
            async fn last_event(
                &self,
                _: &str,
                _: &str,
            ) -> Result<Option<LedgerEvent>, String> {
                Ok(None)
            }
            async fn search_events(
                &self,
                _: &str,
                substring: &str,
            ) -> Result<Vec<LedgerEvent>, String> {
                *self.last.lock().unwrap() = Some(substring.to_string());
                Ok(vec![])
            }
        }
        let recorder = Arc::new(Recording {
            last: Mutex::new(None),
        });
        let tools = build_ledger_tools(recorder.clone());
        let search = tools.iter().find(|t| t.name == "search_events").unwrap();
        let mut input = Map::new();
        input.insert("runId".into(), Value::String("r1".into()));
        input.insert("query".into(), Value::String("foo_bar%".into()));
        (search.handler)(input).await.unwrap();
        let seen = recorder.last.lock().unwrap().clone().unwrap();
        // `_` and `%` MUST be backslash-escaped before reaching the
        // backend so they can only match literally.
        assert_eq!(seen, "foo\\_bar\\%");
    }

    #[test]
    fn escape_like_doubles_backslashes_and_wildcards() {
        assert_eq!(escape_like("a%b"), "a\\%b");
        assert_eq!(escape_like("a_b"), "a\\_b");
        assert_eq!(escape_like("a\\b"), "a\\\\b");
        assert_eq!(escape_like("plain"), "plain");
    }
}
