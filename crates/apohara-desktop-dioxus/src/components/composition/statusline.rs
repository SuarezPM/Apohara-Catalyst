//! Statusline — Wave B (G2.C.3.3) stub. Real impl follows TDD in this task.

use dioxus::prelude::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ContextLevel {
    Ok,
    Caution,
    Warning,
    Critical,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StatuslineState {
    pub session: Option<String>,
    pub tokens_used: u64,
    pub tokens_limit: u64,
    pub context_level: ContextLevel,
    pub active_tool_count: u32,
    pub last_hook: Option<String>,
    pub last_tool_latency_ms: Option<u64>,
    pub banner_message: Option<String>,
}

#[component]
pub fn Statusline(state: StatuslineState) -> Element {
    let _ = state;
    rsx! { div { class: "statusline-stub" } }
}
