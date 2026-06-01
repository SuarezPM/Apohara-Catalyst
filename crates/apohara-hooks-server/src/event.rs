//! `/event` endpoint — receives normalized hook events from native CLI agents.
//!
//! Per spec §3.5: incoming envelope carries `type` discriminator plus a
//! `payload` object. We re-fold the discriminator into the payload and let
//! serde validate against the strongly-typed [`HookEventPayload`] enum.
//! Unknown discriminators → HTTP 422.

use axum::{extract::State, http::StatusCode, response::Json};
use serde::{Deserialize, Serialize};

use crate::AppState;

/// Normalized hook events the loopback server accepts.
///
/// Field optionality is load-bearing: the native hook scripts forward the host
/// CLI's *raw* stdin JSON as the nested `payload`, and that shape does not carry
/// every field this server tracks. For example Claude Code's `PostToolUse`
/// stdin uses `tool_response` (aliased here onto `tool_output`) and ships
/// neither `duration_ms` nor `timestamp`. Required fields here are limited to
/// the ones a host actually guarantees per event (e.g. `tool_name` on tool
/// events); everything the orchestrator merely *prefers* defaults so the native
/// POST validates to 200 instead of 422. Unknown stdin fields (`session_id`,
/// `cwd`, `hook_event_name`, …) are ignored by serde.
#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum HookEventPayload {
    PreToolUse {
        tool_name: String,
        #[serde(default)]
        tool_input: serde_json::Value,
        #[serde(default)]
        timestamp: i64,
    },
    PostToolUse {
        tool_name: String,
        // Claude Code's stdin names this `tool_response`; accept either.
        #[serde(default, alias = "tool_response")]
        tool_output: serde_json::Value,
        #[serde(default)]
        duration_ms: u64,
        #[serde(default)]
        timestamp: i64,
    },
    PostToolUseFailure {
        tool_name: String,
        #[serde(default)]
        error: String,
        #[serde(default)]
        timestamp: i64,
    },
    Stop {
        #[serde(default)]
        reason: StopReason,
        #[serde(default)]
        timestamp: i64,
    },
    UserPromptSubmit {
        #[serde(default)]
        prompt: String,
        #[serde(default)]
        timestamp: i64,
    },
    PermissionRequest {
        tool_name: String,
        #[serde(default)]
        tool_input: serde_json::Value,
        #[serde(default)]
        scope_proposed: Option<String>,
        #[serde(default)]
        timestamp: i64,
    },
}

#[derive(Debug, Default, Deserialize, Serialize, Clone)]
#[serde(rename_all = "snake_case")]
pub enum StopReason {
    #[default]
    Completed,
    Interrupted,
    Crashed,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct HookEventEnvelope {
    #[serde(rename = "type")]
    pub event_type: String,
    pub pane_key: String,
    pub task_id: Option<String>,
    pub worktree_id: Option<String>,
    pub payload: serde_json::Value,
}

pub async fn handle_event(
    State(state): State<AppState>,
    Json(envelope): Json<HookEventEnvelope>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    // Re-fold the discriminator into payload and validate against the
    // tagged enum. A hostile client could otherwise send
    // `{"event_type":"pre_tool_use","payload":{"type":"stop", ...}}`
    // and have the inner `type` win the merge — the server would
    // validate a `Stop` shape while logging it as `pre_tool_use`.
    // Reject any payload that ALREADY carries its own `type` key so
    // the envelope's `event_type` field is the only source of truth.
    if let Some(obj) = envelope.payload.as_object() {
        if obj.contains_key("type") {
            return Err(StatusCode::UNPROCESSABLE_ENTITY);
        }
    }
    let mut tagged = serde_json::Map::new();
    if let Some(obj) = envelope.payload.as_object() {
        for (k, v) in obj {
            tagged.insert(k.clone(), v.clone());
        }
    }
    // Insert `type` AFTER the payload merge so even a defensive caller
    // who tries to shadow the field can't win against us.
    tagged.insert(
        "type".into(),
        serde_json::Value::String(envelope.event_type.clone()),
    );
    let payload: HookEventPayload = match serde_json::from_value(serde_json::Value::Object(tagged))
    {
        Ok(p) => p,
        Err(_) => return Err(StatusCode::UNPROCESSABLE_ENTITY),
    };

    // Forward to in-process subscribers (UI bridge, ledger appender,
    // future Coordinator loop). `send` returns Err when there are no
    // active subscribers — that's benign, just a startup-window or
    // headless-server condition, never a hard failure.
    if state.broadcaster.send(payload).is_err() {
        tracing::warn!(
            event_type = %envelope.event_type,
            "hooks-server: no active subscribers for event"
        );
    }

    tracing::info!(
        event_type = %envelope.event_type,
        pane = %envelope.pane_key,
        task = ?envelope.task_id,
        "hook event broadcast"
    );

    Ok(Json(serde_json::json!({ "accepted": true })))
}
