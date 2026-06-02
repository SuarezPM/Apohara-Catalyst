//! F2.4 utilization dashboard panel.
//!
//! Renders the [`UTILIZATION`] global signal: per-blade busy/idle, the
//! anti-idle health flag (idle blades while work waits = wasted capacity),
//! tokens-per-run, and blades excluded for not speaking MCP (F1.3). The
//! snapshot is computed by a watcher and published to the signal; this
//! component is a pure projection of it.

use dioxus::prelude::*;

use crate::state::utilization::UTILIZATION;

#[component]
pub fn UtilizationPanel() -> Element {
    // Clone out of the read guard so it isn't held across the rsx build.
    let u = UTILIZATION.read().clone();
    let idle_class = if u.zero_idle_ok {
        "util-status util-ok"
    } else {
        "util-status util-warn"
    };
    let idle_label = if u.zero_idle_ok {
        "✓ no idle blade while work waits"
    } else {
        "⚠ idle blades while work is ready"
    };
    let excluded = u.excluded.join(", ");
    let has_excluded = !u.excluded.is_empty();

    rsx! {
        div { class: "utilization-panel",
            h3 { class: "util-title", "Mesh utilization" }
            div { class: "util-row",
                "Blades: {u.active_claims}/{u.available_blades} busy · {u.idle_blades} idle"
            }
            div { class: "util-row", "Ready tasks: {u.ready_count}" }
            div { class: "{idle_class}", "{idle_label}" }
            div { class: "util-row", "Tokens this run: {u.tokens_in} in / {u.tokens_out} out" }
            if has_excluded {
                div { class: "util-excluded", "Excluded (no MCP): {excluded}" }
            }
        }
    }
}
