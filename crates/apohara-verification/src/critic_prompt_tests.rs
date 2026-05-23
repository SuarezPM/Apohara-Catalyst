//! Tests for the critic prompt builder (ported from
//! `src/core/verification/prompts/critic.ts`).

use crate::critic_prompt::{build_critic_prompt, CriticContext};

#[test]
fn prompt_without_incidents_omits_incidents_heading() {
    let p = build_critic_prompt(&CriticContext {
        task_description: "Add login endpoint".to_string(),
        prior_attempts: 0,
        incidents: None,
    });
    assert!(p.contains("You are the critic"), "prompt: {p}");
    assert!(p.contains("## Task\nAdd login endpoint"), "prompt: {p}");
    assert!(p.contains("## Prior attempts: 0"), "prompt: {p}");
    assert!(!p.contains("Past incidents"), "incidents heading must be absent");
}

#[test]
fn empty_incidents_vec_also_omits_heading() {
    let p = build_critic_prompt(&CriticContext {
        task_description: "task".to_string(),
        prior_attempts: 1,
        incidents: Some(vec![]),
    });
    assert!(!p.contains("Past incidents"), "empty vec → no heading (TS parity)");
}

#[test]
fn incidents_are_rendered_as_bullets() {
    let p = build_critic_prompt(&CriticContext {
        task_description: "task".to_string(),
        prior_attempts: 2,
        incidents: Some(vec![
            "leaked api key".to_string(),
            "race in result watcher".to_string(),
        ]),
    });
    assert!(p.contains("## Past incidents to watch for"));
    assert!(p.contains("- leaked api key"));
    assert!(p.contains("- race in result watcher"));
}

#[test]
fn prompt_always_ends_with_report_directive() {
    let p = build_critic_prompt(&CriticContext {
        task_description: "x".to_string(),
        prior_attempts: 0,
        incidents: None,
    });
    assert!(
        p.trim_end()
            .ends_with("Report: APPROVE | NEEDS_CHANGES (with specific items) | REJECT (with rationale)."),
        "got: {p}"
    );
}

#[test]
fn prior_attempts_count_is_inserted_verbatim() {
    let p = build_critic_prompt(&CriticContext {
        task_description: "y".to_string(),
        prior_attempts: 7,
        incidents: None,
    });
    assert!(p.contains("## Prior attempts: 7"));
}

#[test]
fn ctx_serializes_camel_case() {
    let ctx = CriticContext {
        task_description: "t".to_string(),
        prior_attempts: 3,
        incidents: None,
    };
    let json = serde_json::to_string(&ctx).unwrap();
    assert!(json.contains("\"taskDescription\":\"t\""), "got: {json}");
    assert!(json.contains("\"priorAttempts\":3"), "got: {json}");
    // incidents=None must be skipped (TS omits the key).
    assert!(!json.contains("incidents"), "got: {json}");
}
