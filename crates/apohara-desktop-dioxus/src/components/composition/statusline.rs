//! Statusline — Apohara Catalyst footer status bar (G2.C.3.3).
//!
//! Direct port of `packages/desktop/src/components/Statusline.tsx`. The
//! React original drained `statusAtom` via jotai; the Dioxus version will
//! bind `state::status::STATUS` once Implementer 1 lands it. For Wave B the
//! component renders from a `StatuslineState` prop so the SSR tests stay
//! deterministic.
//!
//! Visible badges (preserved 1:1):
//!   - Session label (`◇ <id>` truncated to 14 chars, or `◇ no session`).
//!   - Token usage (`⊞ used / limit (pct%)`), formatted with thousand
//!     separators.
//!   - Context band (color + label per `ContextLevel`).
//!   - Active tool count (`⚙ N active`).
//!   - Optional last hook + latency (`last: PreToolUse (42ms)`).
//!   - Optional red banner spanning the right edge when `banner_message`
//!     is set (e.g. compaction imminent).
//!
//! ARIA: `role="status"` + `aria-live="polite"` so screen readers announce
//! the level change without yanking focus.

use dioxus::prelude::*;

/// Context-window threshold band. Mirrors the TS `ContextLevel` union.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ContextLevel {
    Ok,
    Caution,
    Warning,
    Critical,
}

impl ContextLevel {
    fn key(self) -> &'static str {
        match self {
            ContextLevel::Ok => "ok",
            ContextLevel::Caution => "caution",
            ContextLevel::Warning => "warning",
            ContextLevel::Critical => "critical",
        }
    }

    fn label(self) -> &'static str {
        match self {
            ContextLevel::Ok => "OK",
            ContextLevel::Caution => "CAUTION",
            ContextLevel::Warning => "WARNING",
            ContextLevel::Critical => "CRITICAL",
        }
    }
}

/// Aggregate state rendered by the statusline. Mirrors the TS
/// `StatusState` shape from `store/statusStore.ts`.
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

fn format_with_commas(n: u64) -> String {
    let s = n.to_string();
    let bytes = s.as_bytes();
    let mut out = String::with_capacity(s.len() + s.len() / 3);
    let len = bytes.len();
    for (idx, b) in bytes.iter().enumerate() {
        if idx > 0 && (len - idx).is_multiple_of(3) {
            out.push(',');
        }
        out.push(*b as char);
    }
    out
}

fn pct(used: u64, limit: u64) -> u64 {
    if limit == 0 {
        return 0;
    }
    ((used as f64 / limit as f64) * 100.0).round() as u64
}

#[component]
pub fn Statusline(state: StatuslineState) -> Element {
    let session_text = match &state.session {
        Some(id) => {
            let truncated: String = id.chars().take(14).collect();
            format!("\u{25C7} {truncated}")
        }
        None => "\u{25C7} no session".to_string(),
    };

    let tokens_text = if state.tokens_limit > 0 {
        format!(
            "\u{229E} {} / {} ({}%)",
            format_with_commas(state.tokens_used),
            format_with_commas(state.tokens_limit),
            pct(state.tokens_used, state.tokens_limit)
        )
    } else {
        format!("\u{229E} {}", format_with_commas(state.tokens_used))
    };

    let level_key = state.context_level.key();
    let level_label = state.context_level.label();
    let level_class = format!("statusline-level statusline-level--{level_key}");

    let tools_text = format!("\u{2699} {} active", state.active_tool_count);

    let last_hook = state.last_hook.clone();
    let latency = state.last_tool_latency_ms;
    let banner = state.banner_message.clone();
    let tokens_title = format!("{} / {}", state.tokens_used, state.tokens_limit);

    rsx! {
        div {
            class: "statusline",
            "data-testid": "statusline",
            role: "status",
            "aria-live": "polite",

            span {
                class: "statusline-cell",
                "data-testid": "status-session",
                "{session_text}"
            }

            span {
                class: "statusline-cell",
                "data-testid": "status-tokens",
                title: "{tokens_title}",
                "{tokens_text}"
            }

            span {
                class: "{level_class}",
                "data-testid": "status-level",
                "data-level": "{level_key}",
                "{level_label}"
            }

            span {
                class: "statusline-cell",
                "data-testid": "status-tools",
                "{tools_text}"
            }

            if let Some(hook) = last_hook {
                span {
                    class: "statusline-cell statusline-cell--muted",
                    "data-testid": "status-last-hook",
                    "last: {hook}"
                    if let Some(ms) = latency {
                        " ({ms}ms)"
                    }
                }
            }

            div { class: "statusline-spacer" }

            if let Some(message) = banner {
                span {
                    class: "statusline-banner",
                    "data-testid": "status-banner",
                    "! {message}"
                }
            }
        }
    }
}

#[cfg(test)]
mod helper_tests {
    use super::{format_with_commas, pct};

    #[test]
    fn format_with_commas_handles_small_numbers() {
        assert_eq!(format_with_commas(0), "0");
        assert_eq!(format_with_commas(42), "42");
        assert_eq!(format_with_commas(999), "999");
    }

    #[test]
    fn format_with_commas_inserts_thousands_separators() {
        assert_eq!(format_with_commas(1_000), "1,000");
        assert_eq!(format_with_commas(12_345), "12,345");
        assert_eq!(format_with_commas(1_234_567), "1,234,567");
    }

    #[test]
    fn pct_returns_zero_when_limit_is_zero() {
        assert_eq!(pct(100, 0), 0);
    }

    #[test]
    fn pct_rounds_to_nearest_integer() {
        assert_eq!(pct(25, 100), 25);
        assert_eq!(pct(1, 3), 33); // 33.333... rounds down
        assert_eq!(pct(2, 3), 67); // 66.666... rounds up
    }
}
