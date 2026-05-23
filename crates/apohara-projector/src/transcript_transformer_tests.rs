use super::transcript_transformer::*;
use serde_json::json;

fn mk_event(
    id: &str,
    timestamp: &str,
    event_type: &str,
    task_id: Option<&str>,
    payload: serde_json::Value,
) -> EventLog {
    EventLog {
        id: id.to_string(),
        timestamp: timestamp.to_string(),
        event_type: event_type.to_string(),
        severity: EventSeverity::Info,
        task_id: task_id.map(String::from),
        payload,
        metadata: None,
    }
}

#[test]
fn cards_skip_events_without_task_id() {
    let evs = vec![mk_event(
        "e1",
        "2026-05-22T00:00:00Z",
        "session_started",
        None,
        json!({}),
    )];
    let cards = project_to_ui_cards(&evs);
    assert!(cards.is_empty());
}

#[test]
fn task_scheduled_creates_pending_card_with_payload_fields() {
    let evs = vec![mk_event(
        "e1",
        "2026-05-22T10:00:00Z",
        "task_scheduled",
        Some("t1"),
        json!({"prompt": "do thing", "workdir": "/tmp/ws", "providerId": "claude"}),
    )];
    let cards = project_to_ui_cards(&evs);
    assert_eq!(cards.len(), 1);
    let c = &cards[0];
    assert_eq!(c.task_id, "t1");
    assert_eq!(c.status, UiTaskStatus::Pending);
    assert_eq!(c.prompt.as_deref(), Some("do thing"));
    assert_eq!(c.workdir.as_deref(), Some("/tmp/ws"));
    assert_eq!(c.provider_id.as_deref(), Some("claude"));
    assert_eq!(c.scheduled_at.as_deref(), Some("2026-05-22T10:00:00Z"));
}

#[test]
fn provider_falls_back_to_metadata_provider() {
    let mut ev = mk_event(
        "e1",
        "2026-05-22T10:00:00Z",
        "task_scheduled",
        Some("t1"),
        json!({"prompt": "x"}),
    );
    ev.metadata = Some(EventMetadata {
        provider: Some("codex".to_string()),
    });
    let cards = project_to_ui_cards(&[ev]);
    assert_eq!(cards[0].provider_id.as_deref(), Some("codex"));
}

#[test]
fn task_completed_sets_status_result_and_duration() {
    let scheduled = mk_event(
        "e1",
        "2026-05-22T10:00:00Z",
        "task_scheduled",
        Some("t1"),
        json!({"prompt": "p"}),
    );
    let completed = mk_event(
        "e2",
        "2026-05-22T10:00:05.000Z",
        "task_completed",
        Some("t1"),
        json!({"content": "OK"}),
    );
    let cards = project_to_ui_cards(&[scheduled, completed]);
    assert_eq!(cards.len(), 1);
    assert_eq!(cards[0].status, UiTaskStatus::Completed);
    assert_eq!(cards[0].result.as_deref(), Some("OK"));
    assert_eq!(cards[0].duration_ms, Some(5_000));
    assert_eq!(
        cards[0].completed_at.as_deref(),
        Some("2026-05-22T10:00:05.000Z")
    );
}

#[test]
fn task_failed_sets_status_error_and_duration() {
    let scheduled = mk_event(
        "e1",
        "2026-05-22T10:00:00Z",
        "task_scheduled",
        Some("t1"),
        json!({}),
    );
    let failed = mk_event(
        "e2",
        "2026-05-22T10:00:02Z",
        "task_failed",
        Some("t1"),
        json!({"error": "boom"}),
    );
    let cards = project_to_ui_cards(&[scheduled, failed]);
    assert_eq!(cards[0].status, UiTaskStatus::Failed);
    assert_eq!(cards[0].error.as_deref(), Some("boom"));
    assert_eq!(cards[0].duration_ms, Some(2_000));
}

#[test]
fn duration_ms_skipped_when_scheduled_missing() {
    let only_completed = mk_event(
        "e1",
        "2026-05-22T10:00:05Z",
        "task_completed",
        Some("t1"),
        json!({"content": "OK"}),
    );
    let cards = project_to_ui_cards(&[only_completed]);
    assert_eq!(cards[0].duration_ms, None);
}

#[test]
fn cards_preserve_first_appearance_order() {
    let evs = vec![
        mk_event(
            "e1",
            "2026-05-22T10:00:00Z",
            "task_scheduled",
            Some("t-z"),
            json!({}),
        ),
        mk_event(
            "e2",
            "2026-05-22T10:00:01Z",
            "task_scheduled",
            Some("t-a"),
            json!({}),
        ),
        mk_event(
            "e3",
            "2026-05-22T10:00:02Z",
            "task_completed",
            Some("t-z"),
            json!({}),
        ),
    ];
    let cards = project_to_ui_cards(&evs);
    assert_eq!(cards.len(), 2);
    assert_eq!(cards[0].task_id, "t-z");
    assert_eq!(cards[1].task_id, "t-a");
}

#[test]
fn empty_string_payload_field_is_treated_as_absent() {
    let ev = mk_event(
        "e1",
        "2026-05-22T10:00:00Z",
        "task_scheduled",
        Some("t1"),
        json!({"prompt": ""}),
    );
    let cards = project_to_ui_cards(&[ev]);
    assert_eq!(cards[0].prompt, None);
}

#[test]
fn search_row_emitted_per_event_with_default_tags() {
    let evs = vec![mk_event(
        "e1",
        "2026-05-22T00:00:00Z",
        "task_scheduled",
        Some("t1"),
        json!({"prompt": "hi"}),
    )];
    let rows = project_to_search_rows(&evs);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].event_id, "e1");
    assert_eq!(rows[0].task_id.as_deref(), Some("t1"));
    assert_eq!(rows[0].text, "hi");
    assert!(rows[0].tags.contains(&"type:task_scheduled".to_string()));
    assert!(rows[0].tags.contains(&"severity:info".to_string()));
    assert!(rows[0].tags.contains(&"task:t1".to_string()));
}

#[test]
fn search_row_concatenates_text_fields_with_middle_dot() {
    let ev = mk_event(
        "e1",
        "2026-05-22T00:00:00Z",
        "log",
        Some("t1"),
        json!({"prompt": "p", "content": "c", "error": "e", "workdir": "/w", "message": "m"}),
    );
    let rows = project_to_search_rows(&[ev]);
    assert_eq!(rows[0].text, "p \u{00B7} c \u{00B7} e \u{00B7} /w \u{00B7} m");
}

#[test]
fn search_row_provider_tag_prefers_metadata() {
    let mut ev = mk_event(
        "e1",
        "2026-05-22T00:00:00Z",
        "log",
        None,
        json!({"providerId": "codex"}),
    );
    ev.metadata = Some(EventMetadata {
        provider: Some("claude".to_string()),
    });
    let rows = project_to_search_rows(&[ev]);
    // metadata.provider takes precedence over payload.providerId.
    assert!(rows[0].tags.contains(&"provider:claude".to_string()));
    assert!(!rows[0].tags.contains(&"provider:codex".to_string()));
}

#[test]
fn search_row_provider_tag_falls_back_to_payload() {
    let ev = mk_event(
        "e1",
        "2026-05-22T00:00:00Z",
        "log",
        None,
        json!({"providerId": "codex"}),
    );
    let rows = project_to_search_rows(&[ev]);
    assert!(rows[0].tags.contains(&"provider:codex".to_string()));
}

#[test]
fn search_row_omits_optional_tags_when_absent() {
    let ev = mk_event("e1", "2026-05-22T00:00:00Z", "log", None, json!({}));
    let rows = project_to_search_rows(&[ev]);
    let task_tag = rows[0].tags.iter().any(|t| t.starts_with("task:"));
    let provider_tag = rows[0].tags.iter().any(|t| t.starts_with("provider:"));
    assert!(!task_tag, "no task:* tag when task_id absent");
    assert!(!provider_tag, "no provider:* tag when both sources absent");
}

#[test]
fn severity_serializes_as_lowercase_in_tags() {
    let mut ev = mk_event("e1", "2026-05-22T00:00:00Z", "log", None, json!({}));
    ev.severity = EventSeverity::Warning;
    let rows = project_to_search_rows(&[ev]);
    assert!(rows[0].tags.contains(&"severity:warning".to_string()));
}

#[test]
fn event_log_round_trips_through_serde_with_camelcase_keys() {
    let json = serde_json::json!({
        "id": "e1",
        "timestamp": "2026-05-22T00:00:00Z",
        "type": "task_scheduled",
        "severity": "info",
        "taskId": "t1",
        "payload": {"prompt": "hi"},
        "metadata": {"provider": "claude"}
    });
    let ev: EventLog = serde_json::from_value(json).unwrap();
    assert_eq!(ev.event_type, "task_scheduled");
    assert_eq!(ev.task_id.as_deref(), Some("t1"));
    assert_eq!(ev.metadata.unwrap().provider.as_deref(), Some("claude"));
}

#[test]
fn ui_card_serializes_with_camelcase_keys() {
    let card = UiTaskCard {
        task_id: "t1".to_string(),
        status: UiTaskStatus::Completed,
        provider_id: Some("claude".to_string()),
        prompt: None,
        workdir: None,
        result: Some("ok".to_string()),
        error: None,
        scheduled_at: Some("2026-05-22T10:00:00Z".to_string()),
        completed_at: Some("2026-05-22T10:00:05Z".to_string()),
        duration_ms: Some(5_000),
    };
    let s = serde_json::to_string(&card).unwrap();
    assert!(s.contains("\"taskId\":\"t1\""));
    assert!(s.contains("\"providerId\":\"claude\""));
    assert!(s.contains("\"durationMs\":5000"));
    assert!(s.contains("\"status\":\"completed\""));
    assert!(!s.contains("\"prompt\""), "absent optionals must skip");
}
