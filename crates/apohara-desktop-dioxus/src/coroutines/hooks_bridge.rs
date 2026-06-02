//! `hooks_bridge` coroutine — Stage 2.6 live agent-hooks wiring.
//!
//! Starts the `apohara-hooks-server` loopback sidecar on an ephemeral port,
//! publishes the endpoint file the CLI hook scripts read, and fans the
//! validated `HookEventPayload` stream into the desktop's UI state:
//!
//!   - every event → an `SseEvent` on the recent-events tape (`SSE_EVENTS`),
//!     so the hook log / humanizer surfaces render the live tail.
//!   - `PermissionRequest` ALSO enqueues a `PermissionRequestEvent` on
//!     `PERMISSIONS`, so the PermissionDialogOverlay can prompt the user.
//!
//! The server handle is kept alive inside this coroutine's task for the whole
//! app lifetime: the task only ends when the app does, and dropping the handle
//! is what tears the server down + removes the endpoint file.
//!
//! Self-driven owner (no inbound messages), so it ignores its receiver — same
//! shape as `reconciler_tick` / `permission_arbitrator`.

use std::sync::Arc;

use dioxus::prelude::*;
use tokio::sync::broadcast::error::RecvError;

use apohara_hooks_server::event::{HookEventPayload, StopReason};
use apohara_hooks_server::{HooksServer, ServerConfig};

use crate::state::permissions::{
    enqueue_permission_request, PermissionRequestEvent, PermissionScope,
};
use crate::state::sse_events::{push_event, SseEvent};

/// Mount the bridge. Starts the server, then drains its broadcast channel for
/// the app lifetime. Self-driven — the receiver is unused.
pub fn mount() {
    let _ = use_coroutine(|mut _rx: UnboundedReceiver<()>| async move {
        // Fresh per-process bearer token — never hardcoded. The hook scripts
        // read it back from the endpoint file the server publishes on start.
        let cfg = ServerConfig {
            bearer_token: uuid::Uuid::new_v4().to_string(),
            // Ephemeral loopback port; the published endpoint file carries the
            // resolved port so the scripts discover it. 127.0.0.1 only.
            bind_addr: "127.0.0.1:0"
                .parse()
                .expect("static loopback addr parses"),
            // F2.3 push path: same mailbox root as the mesh bus + dispatch
            // loop (`<cwd>/.apohara/mailbox`). Safe-additive — a PreToolUse/Stop
            // for a pane with no inbox simply peeks empty and returns no
            // additionalContext (identical to the prior observe-only behavior),
            // so this never regresses the live path; it activates only once a
            // blade's recipient inbox holds a message.
            mailbox_root: std::env::current_dir()
                .ok()
                .map(|d| d.join(".apohara").join("mailbox")),
        };

        let server = match HooksServer::start(Arc::new(cfg)).await {
            Ok(s) => s,
            Err(e) => {
                // Without the server there is no live hook stream; the UI keeps
                // working, it just won't show hook events. Non-fatal.
                tracing::warn!(?e, "hooks-bridge: failed to start loopback server");
                return;
            }
        };
        tracing::info!(addr = %server.bound_addr(), "hooks-bridge: loopback server up");

        let mut rx = server.subscribe();
        loop {
            match rx.recv().await {
                Ok(ev) => route_event(ev),
                // A slow tick let the 256-deep channel wrap; we lost `n` events
                // but the receiver stays valid. Surface the gap, keep draining.
                Err(RecvError::Lagged(n)) => {
                    tracing::warn!(skipped = n, "hooks-bridge: lagged, dropped events");
                }
                // Sender gone — only happens if the server handle is dropped,
                // i.e. teardown. Nothing left to do.
                Err(RecvError::Closed) => break,
            }
        }
        // `server` is dropped here (app teardown), which shuts the sidecar down
        // and removes the endpoint file. Holding it in scope this long is the
        // whole point — see module docs.
        drop(server);
    });
}

/// Translate one `HookEventPayload` into UI state. Pure routing: every event
/// lands on the SSE tape; permission requests additionally enqueue a prompt.
fn route_event(ev: HookEventPayload) {
    let (kind, payload, ts) = describe(&ev);
    push_event(SseEvent {
        kind: kind.to_string(),
        payload,
        ts,
    });

    if let HookEventPayload::PermissionRequest {
        tool_name,
        scope_proposed,
        timestamp,
        ..
    } = &ev
    {
        enqueue_permission_request(build_permission_request(
            tool_name,
            scope_proposed.as_deref(),
            *timestamp as u64,
        ));
    }
}

/// Build the `PermissionRequestEvent` for one hook `PermissionRequest`.
///
/// The hook server has no request_id field. A tool+timestamp id collides when
/// the same tool fires twice in one tick, and the per-prompt dedup map would
/// then drop the earlier pending prompt — so mint a fresh UUID per request to
/// keep every prompt distinct.
fn build_permission_request(
    tool: &str,
    scope_proposed: Option<&str>,
    ts: u64,
) -> PermissionRequestEvent {
    PermissionRequestEvent {
        request_id: uuid::Uuid::new_v4().to_string(),
        tool: tool.to_string(),
        suggested_pattern: scope_proposed.unwrap_or_default().to_string(),
        // The hook protocol does not negotiate scopes; offer the full set the
        // dialog supports and let the user pick.
        available_scopes: vec![
            PermissionScope::Once,
            PermissionScope::Session,
            PermissionScope::Always,
        ],
        ts,
    }
}

/// Map an event to its `(kind, human-readable payload, timestamp)` tape entry.
/// `kind` mirrors the SSE doc convention (`hook:<event>`); the payload is a
/// short human line, not the raw JSON, so the hook log reads cleanly.
fn describe(ev: &HookEventPayload) -> (&'static str, String, u64) {
    match ev {
        HookEventPayload::PreToolUse {
            tool_name,
            timestamp,
            ..
        } => (
            "hook:pre-tool-use",
            format!("about to run {tool_name}"),
            *timestamp as u64,
        ),
        HookEventPayload::PostToolUse {
            tool_name,
            duration_ms,
            timestamp,
            ..
        } => (
            "hook:post-tool-use",
            format!("{tool_name} finished in {duration_ms} ms"),
            *timestamp as u64,
        ),
        HookEventPayload::PostToolUseFailure {
            tool_name,
            error,
            timestamp,
        } => (
            "hook:post-tool-use-failure",
            format!("{tool_name} failed: {error}"),
            *timestamp as u64,
        ),
        HookEventPayload::Stop { reason, timestamp } => (
            "hook:stop",
            format!("agent stopped ({})", stop_reason_label(reason)),
            *timestamp as u64,
        ),
        HookEventPayload::UserPromptSubmit { prompt, timestamp } => (
            "hook:user-prompt-submit",
            format!("user prompt: {}", truncate(prompt, 80)),
            *timestamp as u64,
        ),
        HookEventPayload::PermissionRequest {
            tool_name,
            scope_proposed,
            timestamp,
            ..
        } => {
            let scope = scope_proposed
                .as_deref()
                .map(|s| format!(" (scope: {s})"))
                .unwrap_or_default();
            (
                "hook:permission-request",
                format!("permission requested for {tool_name}{scope}"),
                *timestamp as u64,
            )
        }
    }
}

fn stop_reason_label(reason: &StopReason) -> &'static str {
    match reason {
        StopReason::Completed => "completed",
        StopReason::Interrupted => "interrupted",
        StopReason::Crashed => "crashed",
    }
}

/// Clamp `s` to `max` chars, appending an ellipsis when truncated. Char-aware
/// so a multibyte prompt never panics on a byte boundary.
fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let head: String = s.chars().take(max).collect();
    format!("{head}…")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn pre_tool_use_describes_tool_name() {
        let ev = HookEventPayload::PreToolUse {
            tool_name: "Edit".into(),
            tool_input: json!({}),
            timestamp: 7,
        };
        let (kind, payload, ts) = describe(&ev);
        assert_eq!(kind, "hook:pre-tool-use");
        assert!(payload.contains("Edit"));
        assert_eq!(ts, 7);
    }

    #[test]
    fn stop_label_maps_all_reasons() {
        assert_eq!(stop_reason_label(&StopReason::Completed), "completed");
        assert_eq!(stop_reason_label(&StopReason::Interrupted), "interrupted");
        assert_eq!(stop_reason_label(&StopReason::Crashed), "crashed");
    }

    #[test]
    fn permission_request_carries_scope_in_label() {
        let ev = HookEventPayload::PermissionRequest {
            tool_name: "Bash".into(),
            tool_input: json!({"command": "rm -rf /"}),
            scope_proposed: Some("Bash(rm:*)".into()),
            timestamp: 3,
        };
        let (kind, payload, _) = describe(&ev);
        assert_eq!(kind, "hook:permission-request");
        assert!(payload.contains("Bash"));
        assert!(payload.contains("Bash(rm:*)"));
    }

    #[test]
    fn two_permission_requests_for_same_tool_get_distinct_ids() {
        // Same tool, same timestamp (same tick) — the old tool+timestamp id
        // would collide and the dedup map would drop the earlier prompt.
        let a = build_permission_request("Bash", Some("Bash(rm:*)"), 3);
        let b = build_permission_request("Bash", Some("Bash(rm:*)"), 3);
        assert_ne!(a.request_id, b.request_id);
        // The rest of the payload still carries the tool faithfully.
        assert_eq!(a.tool, "Bash");
        assert_eq!(b.tool, "Bash");
    }

    #[test]
    fn truncate_is_char_aware_and_appends_ellipsis() {
        assert_eq!(truncate("short", 80), "short");
        let long = "x".repeat(100);
        let out = truncate(&long, 80);
        assert!(out.ends_with('…'));
        assert_eq!(out.chars().count(), 81); // 80 + ellipsis
    }
}
