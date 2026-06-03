//! Concrete `MeshBackend` over the F0+F1 filesystem stores (US-F2.0a).
//!
//! F0.2 defined `servers::mesh::MeshBackend` trait-first so this crate stayed
//! decoupled from `apohara-dispatch`. This module supplies the concrete
//! adapter the bootstrap wires in, so the mesh MCP tools go LIVE against the
//! same on-disk stores the dispatch loop (US-F1.4) already drives: a real
//! heterogeneous blade can now `claim_task` / `send_message` over MCP and
//! contend on the exact `<base>/.apohara/{claims,tasks,mailbox}` files.
//!
//! It wraps three sibling stores from `apohara-dispatch`, all rooted under one
//! `base` dir (a constructor param — the test roots at a TempDir, production at
//! the repo; never `~/.apohara`):
//!   * [`ClaimStore`] — the cross-process advisory-lock claim (`<base>/.apohara/claims`).
//!   * [`TaskGraph`]  — the dependency DAG / node set    (`<base>/.apohara/tasks`).
//!   * [`Mailbox`]    — the per-recipient inbox queues   (`<base>/.apohara/mailbox`).
//!
//! The stores are sync (sub-ms fs ops); calling them inside the async trait
//! methods is fine — the same shape the `EpisodicLedger` adapter uses to call
//! sync sqlite. Store errors map to `Err(String)` per the F0.2 contract.

use std::path::{Path, PathBuf};

use apohara_audit::{AuditEvent, AuditSink, EventKind};
use apohara_dispatch::{
    ClaimOutcome, ClaimStore, Mailbox, Message, ReportOutcome, RunState, TaskGraph, TaskNode,
};
use async_trait::async_trait;

use crate::servers::mesh::{MeshBackend, MeshMessage, MeshTask};

/// Concrete mesh backend over the F0+F1 stores, rooted at one base dir.
///
/// Cheap to construct (each inner store is a path-only handle), so the
/// bootstrap can build it once and the dispatch loop can build its own
/// pointing at the SAME `base` — they coordinate through the shared files,
/// exactly the BYOC design.
pub struct FsMeshBackend {
    claims: ClaimStore,
    tasks: TaskGraph,
    mailbox: Mailbox,
    /// US-S3 — optional mesh audit sink. `send_message` runs in THIS process
    /// (the desktop is architecturally blind to a blade-side MCP send), so the
    /// `MessageSent` record is emitted here when a sink is attached. `None` for
    /// tests/headless callers that don't want an audit trail.
    audit: Option<AuditSink>,
}

impl FsMeshBackend {
    /// Root all three stores under `<base>/.apohara/{claims,tasks,mailbox}`,
    /// the same layout the dispatch loop and the F1.7 dogfooding test use.
    pub fn new(base: impl AsRef<Path>) -> Self {
        let apohara: PathBuf = base.as_ref().join(".apohara");
        Self {
            claims: ClaimStore::new(apohara.join("claims")),
            tasks: TaskGraph::new(apohara.join("tasks")),
            mailbox: Mailbox::new(apohara.join("mailbox")),
            audit: None,
        }
    }

    /// Attach a mesh audit sink so `send_message` emits a `MessageSent` record
    /// (US-S3). The live bootstrap wires this; tests opt in explicitly.
    pub fn with_audit(mut self, sink: AuditSink) -> Self {
        self.audit = Some(sink);
        self
    }
}

/// Project a claim [`RunState`] onto the F0.2 mesh task-state string.
///
/// Mirrors the F1.5 `merged_status` intent (claimed/running are both "in
/// flight") but emits the wire string the mesh tool returns rather than the
/// desktop `TaskStatus` enum. A node with no claim record yet is `unclaimed`.
fn state_label(state: RunState) -> &'static str {
    match state {
        RunState::Unclaimed => "unclaimed",
        RunState::Claimed => "claimed",
        RunState::Running => "running",
        RunState::RetryQueued => "retry_queued",
        RunState::Released => "released",
    }
}

#[async_trait]
impl MeshBackend for FsMeshBackend {
    async fn get_tasks(&self) -> Result<Vec<MeshTask>, String> {
        // The DAG owns the node set (id/title/deps); the claim store owns the
        // live lifecycle state. Join them per node — a node with no claim
        // record yet reads as `unclaimed`.
        let nodes: Vec<TaskNode> = self.tasks.nodes().map_err(|e| e.to_string())?;
        let mut out = Vec::with_capacity(nodes.len());
        for node in nodes {
            let state = match self.claims.load(&node.id).map_err(|e| e.to_string())? {
                Some(record) => state_label(record.state),
                None => "unclaimed",
            };
            out.push(MeshTask {
                id: node.id,
                title: node.title,
                state: state.to_string(),
                deps: node.deps,
            });
        }
        Ok(out)
    }

    async fn claim_task(&self, task_id: &str, _blade: &str) -> Result<Option<String>, String> {
        // F0.0 cross-process atomic claim: Acquired → carry the token forward;
        // AlreadyClaimed → a clean None (another blade holds it), not an error.
        match self.claims.try_claim(task_id).map_err(|e| e.to_string())? {
            ClaimOutcome::Acquired { token } => Ok(Some(token)),
            ClaimOutcome::AlreadyClaimed => Ok(None),
        }
    }

    async fn release_task(&self, task_id: &str) -> Result<(), String> {
        self.claims.release(task_id).map_err(|e| e.to_string())
    }

    async fn report_result(
        &self,
        task_id: &str,
        token: &str,
        success: bool,
        _output: Option<String>,
    ) -> Result<bool, String> {
        // Validate the token against the live claim first (stale tokens from a
        // reaped-then-re-claimed slot must NOT win). Only on Accepted AND
        // success do we mark the DAG node done so its dependents unlock.
        match self
            .claims
            .report_result(task_id, token)
            .map_err(|e| e.to_string())?
        {
            ReportOutcome::Accepted => {
                if success {
                    self.tasks.mark_done(task_id).map_err(|e| e.to_string())?;
                }
                Ok(true)
            }
            ReportOutcome::StaleToken => Ok(false),
        }
    }

    async fn send_message(&self, msg: MeshMessage) -> Result<(), String> {
        // `MeshMessage` carries the wire fields (from/to/body/ts); the mailbox
        // `Message` adds a local `id` for ack-before-clear (US-F2.3). Leave it
        // empty so `Mailbox::send` mints one — the MCP wire format is unchanged.
        let (from, to, ts) = (msg.from.clone(), msg.to.clone(), msg.ts);
        self.mailbox
            .send(Message {
                id: String::new(),
                from: msg.from,
                to: msg.to,
                body: msg.body,
                ts: msg.ts,
            })
            .map_err(|e| e.to_string())?;

        // US-S3 — emit a MessageSent mesh audit record (best-effort; an audit
        // failure must NEVER fail a blade-to-blade send). The payload carries
        // only routing metadata (ts) — NEVER the message body, which is
        // blade-authored and may contain anything (redaction discipline §0.4).
        if let Some(sink) = &self.audit {
            let _ = sink.write(AuditEvent::mesh(
                EventKind::MessageSent,
                from,
                to,
                serde_json::json!({ "ts": ts }),
            ));
        }
        Ok(())
    }

    async fn check_inbox(&self, blade: &str) -> Result<Vec<MeshMessage>, String> {
        let messages = self.mailbox.check_inbox(blade).map_err(|e| e.to_string())?;
        Ok(messages
            .into_iter()
            .map(|m| MeshMessage {
                from: m.from,
                to: m.to,
                body: m.body,
                ts: m.ts,
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn backend(tmp: &TempDir) -> FsMeshBackend {
        FsMeshBackend::new(tmp.path())
    }

    fn seed_node(b: &FsMeshBackend, id: &str, title: &str, deps: &[&str]) {
        b.tasks
            .add_node(TaskNode {
                id: id.to_string(),
                title: title.to_string(),
                deps: deps.iter().map(|d| d.to_string()).collect(),
            })
            .unwrap();
    }

    #[tokio::test]
    async fn get_tasks_joins_graph_nodes_with_claim_state() {
        let tmp = TempDir::new().unwrap();
        let b = backend(&tmp);
        seed_node(&b, "t1", "first", &[]);
        seed_node(&b, "t2", "second", &["t1"]);

        // Before any claim: both nodes read as unclaimed, deps preserved.
        let tasks = b.get_tasks().await.unwrap();
        assert_eq!(tasks.len(), 2);
        let t1 = tasks.iter().find(|t| t.id == "t1").unwrap();
        assert_eq!(t1.title, "first");
        assert_eq!(t1.state, "unclaimed");
        let t2 = tasks.iter().find(|t| t.id == "t2").unwrap();
        assert_eq!(t2.deps, vec!["t1".to_string()]);

        // After claiming t1, its state flips to "claimed" in the join.
        assert!(b.claim_task("t1", "codex").await.unwrap().is_some());
        let tasks = b.get_tasks().await.unwrap();
        let t1 = tasks.iter().find(|t| t.id == "t1").unwrap();
        assert_eq!(t1.state, "claimed");
    }

    #[tokio::test]
    async fn claim_then_second_claim_is_none() {
        let tmp = TempDir::new().unwrap();
        let b = backend(&tmp);
        seed_node(&b, "t1", "first", &[]);

        let token = b.claim_task("t1", "codex").await.unwrap();
        assert!(token.is_some(), "first claim acquires");
        let second = b.claim_task("t1", "claude").await.unwrap();
        assert!(second.is_none(), "second claim of the same task is None");
    }

    #[tokio::test]
    async fn report_result_marks_done_on_success_and_rejects_stale() {
        let tmp = TempDir::new().unwrap();
        let b = backend(&tmp);
        seed_node(&b, "t1", "first", &[]);

        let token = b.claim_task("t1", "codex").await.unwrap().unwrap();

        // A stale token is rejected and must NOT mark the node done.
        assert!(!b.report_result("t1", "WRONG", true, None).await.unwrap());
        assert!(!b.tasks.is_done("t1").unwrap(), "stale report cannot complete the node");

        // The live token with success → accepted AND the node is marked done.
        assert!(b.report_result("t1", &token, true, None).await.unwrap());
        assert!(b.tasks.is_done("t1").unwrap(), "successful report marks the node done");
    }

    #[tokio::test]
    async fn report_result_accepted_but_not_success_does_not_mark_done() {
        let tmp = TempDir::new().unwrap();
        let b = backend(&tmp);
        seed_node(&b, "t1", "first", &[]);

        let token = b.claim_task("t1", "codex").await.unwrap().unwrap();
        // Accepted (token matches) but success == false → no mark_done.
        assert!(b.report_result("t1", &token, false, None).await.unwrap());
        assert!(
            !b.tasks.is_done("t1").unwrap(),
            "a failed-but-accepted report must not complete the node"
        );
    }

    #[tokio::test]
    async fn release_reopens_the_slot() {
        let tmp = TempDir::new().unwrap();
        let b = backend(&tmp);
        seed_node(&b, "t1", "first", &[]);

        assert!(b.claim_task("t1", "codex").await.unwrap().is_some());
        b.release_task("t1").await.unwrap();
        // Released slot is claimable again.
        assert!(b.claim_task("t1", "claude").await.unwrap().is_some());
    }

    #[tokio::test]
    async fn send_then_check_inbox_roundtrips_on_disk() {
        let tmp = TempDir::new().unwrap();
        let b = backend(&tmp);

        b.send_message(MeshMessage {
            from: "codex".into(),
            to: "claude".into(),
            body: "hi".into(),
            ts: 7,
        })
        .await
        .unwrap();

        let inbox = b.check_inbox("claude").await.unwrap();
        assert_eq!(inbox.len(), 1);
        assert_eq!(inbox[0].from, "codex");
        assert_eq!(inbox[0].body, "hi");
        assert_eq!(inbox[0].ts, 7);
        // Drained: a second poll is empty.
        assert!(b.check_inbox("claude").await.unwrap().is_empty());
    }

    /// US-S3 — a blade `send_message` produces a `MessageSent` audit record from
    /// WITHIN apohara-mcp (the desktop is architecturally blind to it), and the
    /// message BODY never leaks into the audit trail (redaction discipline).
    #[tokio::test]
    async fn send_message_emits_message_sent_audit_without_body_leak() {
        let tmp = TempDir::new().unwrap();
        let audit_dir = tmp.path().join("audit");
        let sink = AuditSink::new(&audit_dir, "mesh-mcp").await.unwrap();
        let b = FsMeshBackend::new(tmp.path()).with_audit(sink);

        b.send_message(MeshMessage {
            from: "codex".into(),
            to: "claude".into(),
            body: "SECRET-do-not-log".into(),
            ts: 42,
        })
        .await
        .unwrap();

        // Let the dedicated async writer task drain the queue to disk.
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;

        let mut found = false;
        for entry in std::fs::read_dir(&audit_dir).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            let content = std::fs::read_to_string(&path).unwrap();
            assert!(
                !content.contains("SECRET"),
                "message body must NOT leak into the audit trail"
            );
            for line in content.lines() {
                let v: serde_json::Value = serde_json::from_str(line).unwrap();
                if v["kind"] == "message_sent" {
                    assert_eq!(v["actor"], "codex", "actor is the sender");
                    assert_eq!(v["target"], "claude", "target is the recipient");
                    assert_eq!(v["payload"]["ts"], 42, "only routing metadata in the payload");
                    found = true;
                }
            }
        }
        assert!(found, "a MessageSent record must be written from within apohara-mcp");
    }

    /// US-S5 — the SINGLE IDENTITY (D5): one DAG node id is the claim key, the
    /// `get_tasks` id, AND the mailbox recipient, all over the SAME on-disk
    /// stores. A blade working `impl-src-auth-rs` claims, is reported by
    /// `get_tasks`, and receives inbox messages under that one id.
    #[tokio::test]
    async fn single_identity_across_claim_get_tasks_and_inbox() {
        let tmp = TempDir::new().unwrap();
        let b = backend(&tmp);
        let node_id = "impl-src-auth-rs";
        seed_node(&b, node_id, "Implement: src/auth.rs", &[]);

        // The loop claims the node id.
        assert!(b.claim_task(node_id, "claude-code-cli").await.unwrap().is_some());

        // get_tasks reports the SAME id, now `claimed` (identity claim<->tasks).
        let tasks = b.get_tasks().await.unwrap();
        let t = tasks.iter().find(|t| t.id == node_id).expect("node id in get_tasks");
        assert_eq!(t.state, "claimed", "the claimed node shows as claimed in get_tasks");

        // A peer addresses the SAME id; the blade drains it (identity tasks<->inbox).
        b.send_message(MeshMessage {
            from: "integrate".into(),
            to: node_id.into(),
            body: "shared types ready".into(),
            ts: 3,
        })
        .await
        .unwrap();
        let inbox = b.check_inbox(node_id).await.unwrap();
        assert_eq!(inbox.len(), 1, "the message is delivered under the node-id identity");
        assert_eq!(inbox[0].body, "shared types ready");
    }

    /// US-S3 — a send with NO audit sink (default) must still succeed: audit is
    /// strictly additive and never on the critical path of a blade send.
    #[tokio::test]
    async fn send_message_without_audit_sink_still_succeeds() {
        let tmp = TempDir::new().unwrap();
        let b = FsMeshBackend::new(tmp.path());
        b.send_message(MeshMessage {
            from: "codex".into(),
            to: "claude".into(),
            body: "hi".into(),
            ts: 1,
        })
        .await
        .unwrap();
        // The message still landed in the mailbox (audit absence changes nothing).
        assert_eq!(b.check_inbox("claude").await.unwrap().len(), 1);
    }
}
