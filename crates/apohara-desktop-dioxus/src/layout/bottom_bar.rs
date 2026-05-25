//! Bottom bar slot (grid-area: bottom). Hosts the Statusline, which polls token
//! totals once a second so the footer refreshes during a run (W3.D.4).

use dioxus::prelude::*;

use apohara_token_accounting::api::{current_totals, TokenTotals};

use crate::components::{ContextLevel, Statusline, StatuslineState};

/// Project roster token totals onto the Statusline prop shape. `StatuslineState`
/// has no per-provider / clock fields, so this surfaces the aggregate token
/// count; the limit / context band default until those feeds exist.
pub(crate) fn statusline_state(totals: &TokenTotals) -> StatuslineState {
    StatuslineState {
        session: None,
        tokens_used: totals.total_in + totals.total_out,
        tokens_limit: 0,
        context_level: ContextLevel::Ok,
        active_tool_count: 0,
        last_hook: None,
        last_tool_latency_ms: None,
        banner_message: None,
    }
}

#[component]
pub fn BottomBar() -> Element {
    // Poll token totals every 1s so the statusline refreshes during a run. The
    // future defers past the SSR render, so tests never spin the loop.
    let tick = use_signal(|| 0u64);
    use_future(move || async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            let next = *tick.read() + 1;
            tick.clone().set(next);
        }
    });
    // Subscribe to the tick so each poll re-renders and re-reads the counter.
    let _ = *tick.read();

    let state = statusline_state(&current_totals());
    rsx! {
        div { class: "bottom", "data-testid": "layout-bottom",
            Statusline { state }
        }
    }
}
