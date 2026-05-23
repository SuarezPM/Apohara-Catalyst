//! Two-tier canonical projection per nimbalyst #5.1 (G5.F.1).
//!
//! The ledger is the SSoT — append-only JSONL with one event per state
//! transition (`task_scheduled`, `task_completed`, `task_failed`, ...).
//! The UI and the search indexer both need a structured view of those
//! events, but they want different shapes:
//!
//! - UI wants one card per `taskId` (latest state wins) so the TaskBoard
//!   can render without re-parsing on every re-render.
//! - Search (FTS5) wants one denormalized row per event with a `text`
//!   column tokenizable by SQLite and a `tags` array for facet filters
//!   (provider, severity, ...).
//!
//! This module parses raw ledger events once and projects them into both
//! shapes. Callers store the projections wherever they like — the
//! projector is pure: no I/O, no side effects.
//!
//! Ported from `src/core/projector/transcript-transformer.ts`.

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Ledger severity levels, mirrored from `src/core/types.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EventSeverity {
    Info,
    Warning,
    Error,
}

/// Raw ledger event input. We accept the minimal subset the projector
/// touches; extra fields in incoming JSON are ignored.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct EventLog {
    pub id: String,
    pub timestamp: String,
    #[serde(rename = "type")]
    pub event_type: String,
    pub severity: EventSeverity,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "taskId")]
    pub task_id: Option<String>,
    #[serde(default)]
    pub payload: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<EventMetadata>,
}

/// Subset of ledger metadata used by the projector. The full TS shape
/// contains 14 fields, but only `provider` is consumed here.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct EventMetadata {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
}

/// UI-friendly task card status (`pending` / `completed` / `failed`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UiTaskStatus {
    Pending,
    Completed,
    Failed,
}

/// UI-friendly task card. One per `taskId`; latest event wins on
/// status / result / error / durationMs. Mirrors the TS `UiTaskCard`
/// shape verbatim through serde renames.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UiTaskCard {
    #[serde(rename = "taskId")]
    pub task_id: String,
    pub status: UiTaskStatus,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "providerId")]
    pub provider_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workdir: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "scheduledAt")]
    pub scheduled_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "completedAt")]
    pub completed_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "durationMs")]
    pub duration_ms: Option<i64>,
}

/// Denormalized row per event for the FTS5-indexable search projection.
/// `text` is the searchable blob; `tags` are categorical facets used by
/// the indexer for `WHERE` filters and the UI's chip bar.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SearchRow {
    #[serde(rename = "eventId")]
    pub event_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "taskId")]
    pub task_id: Option<String>,
    pub timestamp: String,
    #[serde(rename = "type")]
    pub event_type: String,
    pub severity: EventSeverity,
    pub text: String,
    pub tags: Vec<String>,
}

/// Non-empty string accessor: parity with TS `asString`.
fn as_str(v: &Value) -> Option<&str> {
    v.as_str().filter(|s| !s.is_empty())
}

/// Parity with TS Date parsing: ledger timestamps are ISO-8601 / RFC
/// 3339 strings. We avoid pulling chrono just for ms arithmetic and use
/// our own narrow parser that matches `Date.parse` semantics for the
/// `YYYY-MM-DDTHH:MM:SS[.sss]Z` shape the ledger actually emits.
///
/// Returns milliseconds since epoch, or `None` on parse failure (TS
/// would return NaN and the duration_ms computation would silently
/// drop; here we encode that by returning None and skipping the field).
fn parse_iso_ms(s: &str) -> Option<i64> {
    // Defer to chrono via serde_json? No — keep deps lean. The ledger
    // writer uses `new Date().toISOString()` which always emits the
    // canonical `Z`-terminated, fixed-width form. Anything else we treat
    // as opaque and skip.
    chrono::DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|dt| dt.timestamp_millis())
}

/// Fold a stream of ledger events into the UI's per-task view. Insertion
/// order matches the order in which a `taskId` first appeared (FIFO),
/// matching the TS implementation (`Map` preserves insertion order).
///
/// Events without a `taskId` (`session_started`, `hook_event`, `genesis`,
/// ...) are skipped — they belong to the session-level lane.
pub fn project_to_ui_cards(events: &[EventLog]) -> Vec<UiTaskCard> {
    let mut cards: IndexMap<String, UiTaskCard> = IndexMap::new();

    for ev in events {
        let Some(task_id) = ev.task_id.as_deref() else {
            continue;
        };

        let card = cards.entry(task_id.to_string()).or_insert(UiTaskCard {
            task_id: task_id.to_string(),
            status: UiTaskStatus::Pending,
            provider_id: None,
            prompt: None,
            workdir: None,
            result: None,
            error: None,
            scheduled_at: None,
            completed_at: None,
            duration_ms: None,
        });

        let payload = &ev.payload;
        match ev.event_type.as_str() {
            "task_scheduled" => {
                card.status = UiTaskStatus::Pending;
                card.scheduled_at = Some(ev.timestamp.clone());
                if let Some(p) = payload
                    .get("prompt")
                    .and_then(as_str)
                    .map(str::to_string)
                {
                    card.prompt = Some(p);
                }
                if let Some(w) = payload
                    .get("workdir")
                    .and_then(as_str)
                    .map(str::to_string)
                {
                    card.workdir = Some(w);
                }
                let provider = payload
                    .get("providerId")
                    .and_then(as_str)
                    .map(str::to_string)
                    .or_else(|| {
                        ev.metadata
                            .as_ref()
                            .and_then(|m| m.provider.clone())
                            .filter(|s| !s.is_empty())
                    });
                if let Some(p) = provider {
                    card.provider_id = Some(p);
                }
            }
            "task_completed" => {
                card.status = UiTaskStatus::Completed;
                card.completed_at = Some(ev.timestamp.clone());
                if let Some(r) = payload
                    .get("content")
                    .and_then(as_str)
                    .map(str::to_string)
                {
                    card.result = Some(r);
                }
                if let Some(start) = card.scheduled_at.as_deref() {
                    if let (Some(s), Some(e)) =
                        (parse_iso_ms(start), parse_iso_ms(&ev.timestamp))
                    {
                        card.duration_ms = Some(e - s);
                    }
                }
            }
            "task_failed" => {
                card.status = UiTaskStatus::Failed;
                card.completed_at = Some(ev.timestamp.clone());
                if let Some(e) = payload.get("error").and_then(as_str).map(str::to_string) {
                    card.error = Some(e);
                }
                if let Some(start) = card.scheduled_at.as_deref() {
                    if let (Some(s), Some(e)) =
                        (parse_iso_ms(start), parse_iso_ms(&ev.timestamp))
                    {
                        card.duration_ms = Some(e - s);
                    }
                }
            }
            _ => {
                // Other event types don't change the card; the drawer
                // view rebuilds them from the search projection on demand.
            }
        }
    }

    cards.into_values().collect()
}

/// Denormalize each event into a row the FTS5 indexer can `INSERT`
/// directly. `text` concatenates the searchable string fields we know
/// about (separated by " · " to match TS); `tags` carry the categorical
/// facets.
pub fn project_to_search_rows(events: &[EventLog]) -> Vec<SearchRow> {
    const FIELDS: [&str; 5] = ["prompt", "content", "error", "workdir", "message"];
    let mut rows = Vec::with_capacity(events.len());

    for ev in events {
        let payload = &ev.payload;
        let mut fragments: Vec<String> = Vec::new();
        for key in FIELDS {
            if let Some(v) = payload.get(key).and_then(as_str) {
                fragments.push(v.to_string());
            }
        }

        let mut tags = vec![
            format!("type:{}", ev.event_type),
            format!("severity:{}", severity_str(ev.severity)),
        ];
        // metadata.provider takes precedence; fall back to payload.providerId
        // (matches TS `??` chain).
        let provider = ev
            .metadata
            .as_ref()
            .and_then(|m| m.provider.as_deref())
            .filter(|s| !s.is_empty())
            .or_else(|| payload.get("providerId").and_then(as_str));
        if let Some(p) = provider {
            tags.push(format!("provider:{p}"));
        }
        if let Some(t) = ev.task_id.as_deref() {
            tags.push(format!("task:{t}"));
        }

        rows.push(SearchRow {
            event_id: ev.id.clone(),
            task_id: ev.task_id.clone(),
            timestamp: ev.timestamp.clone(),
            event_type: ev.event_type.clone(),
            severity: ev.severity,
            text: fragments.join(" \u{00B7} "),
            tags,
        });
    }

    rows
}

fn severity_str(s: EventSeverity) -> &'static str {
    match s {
        EventSeverity::Info => "info",
        EventSeverity::Warning => "warning",
        EventSeverity::Error => "error",
    }
}
