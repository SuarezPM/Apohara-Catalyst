//! SSR tests for the brand-effect ports (G2.B.2).
//!
//! Reference: `packages/desktop/src/components/AgentStateDot.tsx`.

use super::AgentStateDot;
use dioxus::prelude::*;

// ============================================================================
// AgentStateDot — Sprint 17 G2.B.2 step 1
// ============================================================================

#[test]
fn agent_state_dot_renders_working_with_lime_and_pulse() {
    let html = dioxus_ssr::render_element(rsx! {
        AgentStateDot { state: "working".to_string() }
    });
    assert!(
        html.contains("data-state-dot"),
        "data-state-dot marker missing: {html}"
    );
    assert!(
        html.contains("data-state=\"working\""),
        "working data-state missing: {html}"
    );
    assert!(html.contains("dot-working"), "dot-working class missing: {html}");
    assert!(html.contains("--apohara-lime"), "lime token missing: {html}");
}

#[test]
fn agent_state_dot_idle_uses_muted_class() {
    let html = dioxus_ssr::render_element(rsx! {
        AgentStateDot { state: "idle".to_string() }
    });
    assert!(html.contains("dot-idle"), "dot-idle class missing: {html}");
    assert!(
        html.contains("data-state=\"idle\""),
        "idle data-state missing: {html}"
    );
}

#[test]
fn agent_state_dot_size_sm_renders_8px() {
    let html = dioxus_ssr::render_element(rsx! {
        AgentStateDot { state: "idle".to_string(), size: "sm".to_string() }
    });
    assert!(html.contains("width: 8px"), "sm width missing: {html}");
    assert!(html.contains("height: 8px"), "sm height missing: {html}");
}

#[test]
fn agent_state_dot_default_size_is_md_12px() {
    let html = dioxus_ssr::render_element(rsx! {
        AgentStateDot { state: "idle".to_string() }
    });
    assert!(html.contains("width: 12px"), "md default width missing: {html}");
    assert!(html.contains("height: 12px"), "md default height missing: {html}");
}

#[test]
fn agent_state_dot_uses_custom_label_when_provided() {
    let html = dioxus_ssr::render_element(rsx! {
        AgentStateDot {
            state: "working".to_string(),
            label: "verifier busy".to_string(),
        }
    });
    assert!(
        html.contains("aria-label=\"verifier busy\""),
        "custom aria-label missing: {html}"
    );
}

#[test]
fn agent_state_dot_falls_back_to_state_label() {
    let html = dioxus_ssr::render_element(rsx! {
        AgentStateDot { state: "done".to_string() }
    });
    assert!(
        html.contains("aria-label=\"agent done\""),
        "default aria-label missing: {html}"
    );
}
