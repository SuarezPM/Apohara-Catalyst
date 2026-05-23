//! Pre/PostCompact contract re-injection.
//!
//! Mirrors `src/core/hooks/compact-reinjection.ts` (G5.C.1).
//!
//! Context compaction is destructive: when an agent's context window fills,
//! it summarises / drops earlier turns and the load-bearing state goes
//! with them. The pattern: snapshot the contract on `pre_compact`, then
//! re-inject it as `additionalContext` after `post_compact` so the next
//! prompt picks up where the previous agent left off.
//!
//! In-memory only — snapshots are per-session and ephemeral. Losing them
//! across a process restart is fine because the post-compact event won't
//! fire either (the agent that would have emitted it is also gone).

use chrono::TimeZone;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ContractSnapshot {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(rename = "capturedAt")]
    pub captured_at: i64,
    #[serde(rename = "activePlanIds")]
    pub active_plan_ids: Vec<String>,
    #[serde(rename = "activeTaskId")]
    pub active_task_id: Option<String>,
    pub settings: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AdditionalContextEnvelope {
    #[serde(rename = "additionalContext")]
    pub additional_context: String,
    pub snapshot: ContractSnapshot,
}

/// Inbound payload shapes the central dispatcher feeds us. Field order
/// matches the TS union; serde tag `type` matches the wire contract.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CompactHookEvent {
    PreCompact {
        #[serde(rename = "sessionId")]
        session_id: String,
        contract: PreCompactContract,
        timestamp: i64,
    },
    PostCompact {
        #[serde(rename = "sessionId")]
        session_id: String,
        timestamp: i64,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreCompactContract {
    #[serde(rename = "activePlanIds")]
    pub active_plan_ids: Vec<String>,
    #[serde(rename = "activeTaskId")]
    pub active_task_id: Option<String>,
    pub settings: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum HookOutcome {
    Captured,
    Reinjected {
        #[serde(rename = "additionalContext")]
        additional_context: String,
        snapshot: ContractSnapshot,
    },
    Noop,
    Ignored,
}

/// Per-session snapshot buffer. The TS class wraps a Map<string, snapshot>;
/// the Rust port wraps a Mutex<HashMap> so the bridge can share a single
/// instance across async tasks. Locks are held only for the duration of
/// each Map mutation — never across awaits.
#[derive(Debug, Default)]
pub struct CompactReinjector {
    snapshots: Mutex<HashMap<String, ContractSnapshot>>,
}

impl CompactReinjector {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn capture(&self, snapshot: ContractSnapshot) {
        let mut guard = self.snapshots.lock().expect("compact-reinjector lock poisoned");
        guard.insert(snapshot.session_id.clone(), snapshot);
    }

    /// Destructive pop. Returns `None` when no snapshot is buffered for
    /// `session_id`.
    pub fn consume(&self, session_id: &str) -> Option<ContractSnapshot> {
        let mut guard = self.snapshots.lock().expect("compact-reinjector lock poisoned");
        guard.remove(session_id)
    }

    /// Render the snapshot as an `additionalContext` envelope ready to
    /// merge into the next `user_prompt_submit`. Destructive — the
    /// post-compact agent must only see the re-injection ONCE.
    pub fn render_additional_context(
        &self,
        session_id: &str,
    ) -> Option<AdditionalContextEnvelope> {
        let snap = self.consume(session_id)?;
        let captured_iso = chrono::Utc
            .timestamp_millis_opt(snap.captured_at)
            .single()
            .map(|dt| dt.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
            .unwrap_or_else(|| snap.captured_at.to_string());
        let plans_label = if snap.active_plan_ids.is_empty() {
            "(none)".to_string()
        } else {
            snap.active_plan_ids.join(", ")
        };
        let active_task_label = snap
            .active_task_id
            .clone()
            .unwrap_or_else(|| "(none)".to_string());
        let settings_json = serde_json::to_string(&snap.settings)
            .unwrap_or_else(|_| "{}".to_string());

        let mut lines = vec![
            "### Post-compaction contract re-injection".to_string(),
            String::new(),
            format!("Session: {}", snap.session_id),
            format!("Captured at: {}", captured_iso),
            format!("Active task: {}", active_task_label),
            format!("Active plans: {}", plans_label),
            format!("Settings: {}", settings_json),
        ];
        if let Some(notes) = &snap.notes {
            lines.push(String::new());
            lines.push(format!("Notes: {}", notes));
        }
        Some(AdditionalContextEnvelope {
            additional_context: lines.join("\n"),
            snapshot: snap,
        })
    }

    /// Wire-protocol entry point. Unrelated event variants return
    /// [`HookOutcome::Ignored`] so the central dispatcher can call this
    /// unconditionally without sniffing the variant first.
    pub fn on_hook_event(&self, event: CompactHookEvent) -> HookOutcome {
        match event {
            CompactHookEvent::PreCompact {
                session_id,
                contract,
                timestamp,
            } => {
                self.capture(ContractSnapshot {
                    session_id,
                    captured_at: timestamp,
                    active_plan_ids: contract.active_plan_ids,
                    active_task_id: contract.active_task_id,
                    settings: contract.settings,
                    notes: contract.notes,
                });
                HookOutcome::Captured
            }
            CompactHookEvent::PostCompact { session_id, .. } => {
                match self.render_additional_context(&session_id) {
                    Some(env) => HookOutcome::Reinjected {
                        additional_context: env.additional_context,
                        snapshot: env.snapshot,
                    },
                    None => HookOutcome::Noop,
                }
            }
        }
    }
}
