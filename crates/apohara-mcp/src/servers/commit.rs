//! apohara.commit MCP server.
//!
//! Mirrors `src/core/mcp/servers/apohara-commit.ts`. Exposes the single
//! `apohara_commit_proposal` tool. Default mode: write a
//! `git_commit_proposed` ledger event so the approval widget can
//! render the proposal alongside the diff, and the user explicitly
//! accepts / rejects via a separate surface.
//!
//! When `auto_commit` is true the tool actually commits the staged
//! files and returns the new SHA. Default is OFF so agents cannot push
//! to history without the user's blessing.

use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::input_validation::{optional_string, optional_string_array, require_string};
use crate::server::{tool_handler, McpError, ToolRegistration};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct CommitProposalOutcome {
    pub committed: bool,
    pub pending: bool,
    pub sha: Option<String>,
    pub error: Option<String>,
}

#[async_trait]
pub trait CommitBackend: Send + Sync {
    /// Either records a proposal (pending=true) or actually commits
    /// (committed=true, sha=Some). Implementations decide based on
    /// `auto_commit`. On hard failure, return `committed=false,
    /// pending=false, error=Some(...)`.
    async fn propose(
        &self,
        workspace: &std::path::Path,
        files_to_stage: &[String],
        message: &str,
        reasoning: Option<&str>,
        auto_commit: bool,
    ) -> Result<CommitProposalOutcome, String>;
}

#[derive(Clone)]
pub struct CommitServerCfg {
    pub workspace: PathBuf,
    pub ledger_path: PathBuf,
    pub auto_commit: bool,
}

#[derive(Clone)]
pub struct LedgerWriter {
    path: PathBuf,
    lock: Arc<Mutex<()>>,
}

impl LedgerWriter {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            lock: Arc::new(Mutex::new(())),
        }
    }

    pub async fn append(&self, event: &Value) -> Result<(), std::io::Error> {
        let _g = self.lock.lock().await;
        if let Some(parent) = self.path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let mut line = serde_json::to_vec(event)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        line.push(b'\n');
        use tokio::io::AsyncWriteExt;
        let mut f = tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
            .await?;
        f.write_all(&line).await?;
        f.sync_data().await?;
        Ok(())
    }
}

pub fn build_commit_tools(
    cfg: CommitServerCfg,
    backend: Arc<dyn CommitBackend>,
) -> Vec<ToolRegistration> {
    let ledger = LedgerWriter::new(cfg.ledger_path.clone());
    let cfg = Arc::new(cfg);
    vec![ToolRegistration {
        name: "apohara_commit_proposal".to_string(),
        handler: tool_handler(move |input| {
            let backend = Arc::clone(&backend);
            let ledger = ledger.clone();
            let cfg = Arc::clone(&cfg);
            async move {
                let message = require_string(&input, "commitMessage")?;
                let files = optional_string_array(&input, "filesToStage")?
                    .ok_or_else(|| {
                        McpError::other(
                            "filesToStage must be a non-empty array of strings".to_string(),
                        )
                    })?;
                if files.is_empty() {
                    return Err(McpError::other(
                        "filesToStage must be a non-empty array of strings".to_string(),
                    ));
                }
                let reasoning = optional_string(&input, "reasoning")?;
                let proposal_id = Uuid::new_v4().to_string();

                // Always emit the proposal event so consumers (UI widget,
                // audit log, future review tools) see it regardless of
                // whether we go on to commit.
                let proposal_event = json!({
                    "id": proposal_id,
                    "timestamp": chrono::Utc::now().to_rfc3339(),
                    "type": "git_commit_proposed",
                    "severity": "info",
                    "payload": {
                        "filesToStage": files,
                        "commitMessage": message,
                        "reasoning": reasoning,
                        "autoCommit": cfg.auto_commit,
                    },
                });
                let _ = ledger.append(&proposal_event).await;

                let outcome = backend
                    .propose(
                        &cfg.workspace,
                        &files,
                        &message,
                        reasoning.as_deref(),
                        cfg.auto_commit,
                    )
                    .await
                    .map_err(McpError::other)?;

                if outcome.committed {
                    let _ = ledger
                        .append(&json!({
                            "id": Uuid::new_v4().to_string(),
                            "timestamp": chrono::Utc::now().to_rfc3339(),
                            "type": "git_commit_landed",
                            "severity": "info",
                            "payload": {
                                "proposalId": proposal_id,
                                "sha": outcome.sha,
                                "filesToStage": files,
                            },
                        }))
                        .await;
                } else if !outcome.pending {
                    let _ = ledger
                        .append(&json!({
                            "id": Uuid::new_v4().to_string(),
                            "timestamp": chrono::Utc::now().to_rfc3339(),
                            "type": "git_commit_rejected",
                            "severity": "error",
                            "payload": {
                                "proposalId": proposal_id,
                                "error": outcome.error,
                            },
                        }))
                        .await;
                }

                Ok(json!({
                    "proposalId": proposal_id,
                    "committed": outcome.committed,
                    "pending": outcome.pending,
                    "sha": outcome.sha,
                    "error": outcome.error,
                }))
            }
        }),
    }]
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Map;
    use tempfile::TempDir;

    struct AlwaysPending;
    #[async_trait]
    impl CommitBackend for AlwaysPending {
        async fn propose(
            &self,
            _workspace: &std::path::Path,
            _files: &[String],
            _message: &str,
            _reasoning: Option<&str>,
            _auto_commit: bool,
        ) -> Result<CommitProposalOutcome, String> {
            Ok(CommitProposalOutcome {
                committed: false,
                pending: true,
                sha: None,
                error: None,
            })
        }
    }

    struct AutoCommitsSha(String);
    #[async_trait]
    impl CommitBackend for AutoCommitsSha {
        async fn propose(
            &self,
            _workspace: &std::path::Path,
            _files: &[String],
            _message: &str,
            _reasoning: Option<&str>,
            _auto_commit: bool,
        ) -> Result<CommitProposalOutcome, String> {
            Ok(CommitProposalOutcome {
                committed: true,
                pending: false,
                sha: Some(self.0.clone()),
                error: None,
            })
        }
    }

    fn make_input(message: &str, files: Vec<String>) -> Map<String, Value> {
        let mut m = Map::new();
        m.insert("commitMessage".into(), Value::String(message.into()));
        m.insert(
            "filesToStage".into(),
            Value::Array(files.into_iter().map(Value::String).collect()),
        );
        m
    }

    #[tokio::test]
    async fn requires_non_empty_files_to_stage() {
        let tmp = TempDir::new().unwrap();
        let tools = build_commit_tools(
            CommitServerCfg {
                workspace: tmp.path().to_path_buf(),
                ledger_path: tmp.path().join("ledger.jsonl"),
                auto_commit: false,
            },
            Arc::new(AlwaysPending),
        );
        let t = &tools[0];
        let mut m = Map::new();
        m.insert("commitMessage".into(), Value::String("msg".into()));
        m.insert("filesToStage".into(), Value::Array(vec![]));
        let err = (t.handler)(m).await.unwrap_err();
        assert!(matches!(err, McpError::Other(_)));
    }

    #[tokio::test]
    async fn pending_path_emits_proposal_event_only() {
        let tmp = TempDir::new().unwrap();
        let ledger_path = tmp.path().join("ledger.jsonl");
        let tools = build_commit_tools(
            CommitServerCfg {
                workspace: tmp.path().to_path_buf(),
                ledger_path: ledger_path.clone(),
                auto_commit: false,
            },
            Arc::new(AlwaysPending),
        );
        let out = (tools[0].handler)(make_input("msg", vec!["a.rs".into()]))
            .await
            .unwrap();
        assert_eq!(out["pending"], true);
        assert_eq!(out["committed"], false);

        let raw = tokio::fs::read_to_string(&ledger_path).await.unwrap();
        let lines: Vec<_> = raw.lines().collect();
        assert_eq!(lines.len(), 1, "only proposal event written");
        let parsed: Value = serde_json::from_str(lines[0]).unwrap();
        assert_eq!(parsed["type"], "git_commit_proposed");
        assert_eq!(parsed["payload"]["autoCommit"], false);
    }

    #[tokio::test]
    async fn auto_commit_path_emits_proposal_and_landed_events() {
        let tmp = TempDir::new().unwrap();
        let ledger_path = tmp.path().join("ledger.jsonl");
        let tools = build_commit_tools(
            CommitServerCfg {
                workspace: tmp.path().to_path_buf(),
                ledger_path: ledger_path.clone(),
                auto_commit: true,
            },
            Arc::new(AutoCommitsSha("deadbeef".into())),
        );
        let out = (tools[0].handler)(make_input("msg", vec!["a.rs".into()]))
            .await
            .unwrap();
        assert_eq!(out["committed"], true);
        assert_eq!(out["sha"], "deadbeef");

        let raw = tokio::fs::read_to_string(&ledger_path).await.unwrap();
        let lines: Vec<_> = raw.lines().collect();
        assert_eq!(lines.len(), 2);
        let landed: Value = serde_json::from_str(lines[1]).unwrap();
        assert_eq!(landed["type"], "git_commit_landed");
        assert_eq!(landed["payload"]["sha"], "deadbeef");
    }

    struct RejectsCommit;
    #[async_trait]
    impl CommitBackend for RejectsCommit {
        async fn propose(
            &self,
            _workspace: &std::path::Path,
            _files: &[String],
            _message: &str,
            _reasoning: Option<&str>,
            _auto_commit: bool,
        ) -> Result<CommitProposalOutcome, String> {
            Ok(CommitProposalOutcome {
                committed: false,
                pending: false,
                sha: None,
                error: Some("nothing staged".into()),
            })
        }
    }

    #[tokio::test]
    async fn rejected_path_emits_proposal_and_rejected_events() {
        let tmp = TempDir::new().unwrap();
        let ledger_path = tmp.path().join("ledger.jsonl");
        let tools = build_commit_tools(
            CommitServerCfg {
                workspace: tmp.path().to_path_buf(),
                ledger_path: ledger_path.clone(),
                auto_commit: true,
            },
            Arc::new(RejectsCommit),
        );
        let out = (tools[0].handler)(make_input("msg", vec!["a.rs".into()]))
            .await
            .unwrap();
        assert_eq!(out["committed"], false);
        assert_eq!(out["pending"], false);

        let raw = tokio::fs::read_to_string(&ledger_path).await.unwrap();
        let lines: Vec<_> = raw.lines().collect();
        assert_eq!(lines.len(), 2);
        let rejected: Value = serde_json::from_str(lines[1]).unwrap();
        assert_eq!(rejected["type"], "git_commit_rejected");
        assert_eq!(rejected["payload"]["error"], "nothing staged");
    }
}
