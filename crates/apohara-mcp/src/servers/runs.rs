//! apohara.runs MCP server.
//!
//! Mirrors `src/core/mcp/servers/apohara-runs.ts`. Exposes
//! list_runs / inspect_run / get_current_run / get_run_diff over a
//! trait-backed coordinator-runs store.

use std::sync::Arc;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::input_validation::{optional_integer, optional_string, require_record, require_string};
use crate::server::{tool_handler, McpError, ToolRegistration};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RunRow {
    pub id: i64,
    pub run_id: String,
    pub status: String,
    pub started_at: i64,
    pub ended_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TaskOutcome {
    pub id: String,
    pub status: String,
    pub completed_at: Option<i64>,
}

#[derive(Debug, Default, Clone)]
pub struct ListFilter {
    pub status: Option<String>,
    pub since: Option<i64>,
    pub limit: i64,
}

#[async_trait]
pub trait RunsBackend: Send + Sync {
    async fn list_runs(&self, filter: ListFilter) -> Result<Vec<RunRow>, String>;
    async fn inspect_run(
        &self,
        run_id: &str,
    ) -> Result<(Option<RunRow>, i64 /* task_count */), String>;
    async fn current_run(&self) -> Result<Option<RunRow>, String>;
    async fn run_diff(&self, run_id: &str) -> Result<Vec<TaskOutcome>, String>;
}

pub fn build_runs_tools(backend: Arc<dyn RunsBackend>) -> Vec<ToolRegistration> {
    let b1 = Arc::clone(&backend);
    let b2 = Arc::clone(&backend);
    let b3 = Arc::clone(&backend);
    let b4 = Arc::clone(&backend);
    vec![
        ToolRegistration {
            name: "list_runs".to_string(),
            handler: tool_handler(move |input| {
                let backend = Arc::clone(&b1);
                async move {
                    // `filter` is optional; default to empty object.
                    let empty = serde_json::Map::new();
                    let filter = require_record(&input, "filter")
                        .ok()
                        .cloned()
                        .unwrap_or(empty);
                    let status = optional_string(&filter, "status")?;
                    let since = optional_integer(&filter, "since", None)?;
                    let limit = optional_integer(&filter, "limit", Some(50))?.unwrap_or(50);
                    let runs = backend
                        .list_runs(ListFilter {
                            status,
                            since,
                            limit,
                        })
                        .await
                        .map_err(McpError::other)?;
                    Ok(json!({ "runs": runs }))
                }
            }),
        },
        ToolRegistration {
            name: "inspect_run".to_string(),
            handler: tool_handler(move |input| {
                let backend = Arc::clone(&b2);
                async move {
                    let run_id = require_string(&input, "runId")?;
                    let (run, count) =
                        backend.inspect_run(&run_id).await.map_err(McpError::other)?;
                    Ok(json!({
                        "run": run,
                        "task_count": count,
                    }))
                }
            }),
        },
        ToolRegistration {
            name: "get_current_run".to_string(),
            handler: tool_handler(move |_input| {
                let backend = Arc::clone(&b3);
                async move {
                    let cur = backend.current_run().await.map_err(McpError::other)?;
                    Ok(json!({ "current": cur }))
                }
            }),
        },
        ToolRegistration {
            name: "get_run_diff".to_string(),
            handler: tool_handler(move |input| {
                let backend = Arc::clone(&b4);
                async move {
                    let run_id = require_string(&input, "runId")?;
                    let tasks = backend.run_diff(&run_id).await.map_err(McpError::other)?;
                    Ok(json!({
                        "run_id": run_id,
                        "completed_tasks": tasks,
                    }))
                }
            }),
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Map, Value};

    struct StubRuns {
        runs: Vec<RunRow>,
    }

    #[async_trait]
    impl RunsBackend for StubRuns {
        async fn list_runs(&self, filter: ListFilter) -> Result<Vec<RunRow>, String> {
            let mut out: Vec<RunRow> = self.runs.clone();
            if let Some(s) = &filter.status {
                out.retain(|r| r.status == *s);
            }
            if let Some(since) = filter.since {
                out.retain(|r| r.started_at >= since);
            }
            out.truncate(filter.limit as usize);
            Ok(out)
        }
        async fn inspect_run(
            &self,
            run_id: &str,
        ) -> Result<(Option<RunRow>, i64), String> {
            let row = self.runs.iter().find(|r| r.run_id == run_id).cloned();
            Ok((row, 3))
        }
        async fn current_run(&self) -> Result<Option<RunRow>, String> {
            Ok(self
                .runs
                .iter()
                .find(|r| r.status == "running")
                .cloned())
        }
        async fn run_diff(&self, _run_id: &str) -> Result<Vec<TaskOutcome>, String> {
            Ok(vec![TaskOutcome {
                id: "task-1".to_string(),
                status: "completed".to_string(),
                completed_at: Some(123),
            }])
        }
    }

    fn rows() -> Vec<RunRow> {
        vec![
            RunRow {
                id: 1,
                run_id: "r1".into(),
                status: "running".into(),
                started_at: 1000,
                ended_at: None,
            },
            RunRow {
                id: 2,
                run_id: "r2".into(),
                status: "completed".into(),
                started_at: 500,
                ended_at: Some(700),
            },
        ]
    }

    #[tokio::test]
    async fn list_runs_filters_by_status() {
        let backend = Arc::new(StubRuns { runs: rows() });
        let tools = build_runs_tools(backend);
        let t = tools.iter().find(|t| t.name == "list_runs").unwrap();
        let mut input = Map::new();
        input.insert(
            "filter".into(),
            json!({"status": "running", "limit": 10}),
        );
        let out = (t.handler)(input).await.unwrap();
        let arr = out["runs"].as_array().unwrap();
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["run_id"], "r1");
    }

    #[tokio::test]
    async fn list_runs_accepts_no_filter() {
        let backend = Arc::new(StubRuns { runs: rows() });
        let tools = build_runs_tools(backend);
        let t = tools.iter().find(|t| t.name == "list_runs").unwrap();
        let out = (t.handler)(Map::new()).await.unwrap();
        assert_eq!(out["runs"].as_array().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn inspect_run_returns_task_count() {
        let backend = Arc::new(StubRuns { runs: rows() });
        let tools = build_runs_tools(backend);
        let t = tools.iter().find(|t| t.name == "inspect_run").unwrap();
        let mut input = Map::new();
        input.insert("runId".into(), Value::String("r1".into()));
        let out = (t.handler)(input).await.unwrap();
        assert_eq!(out["task_count"], 3);
        assert_eq!(out["run"]["run_id"], "r1");
    }

    #[tokio::test]
    async fn get_current_run_picks_running() {
        let backend = Arc::new(StubRuns { runs: rows() });
        let tools = build_runs_tools(backend);
        let t = tools.iter().find(|t| t.name == "get_current_run").unwrap();
        let out = (t.handler)(Map::new()).await.unwrap();
        assert_eq!(out["current"]["run_id"], "r1");
    }

    #[tokio::test]
    async fn get_run_diff_requires_runid() {
        let backend = Arc::new(StubRuns { runs: rows() });
        let tools = build_runs_tools(backend);
        let t = tools.iter().find(|t| t.name == "get_run_diff").unwrap();
        let err = (t.handler)(Map::new()).await.unwrap_err();
        assert!(matches!(err, McpError::Validation(_)));
    }
}
