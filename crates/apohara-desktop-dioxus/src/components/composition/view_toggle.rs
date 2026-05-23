//! ViewToggle — Apohara Catalyst view-mode chip group (G2.C.3.2).
//!
//! Direct port of `packages/desktop/src/components/ViewToggle.tsx`. The
//! React original wired `viewModeAtom` / `setViewModeAtom` from
//! `store/viewStore.ts`. The Dioxus side will bind `state::view_mode::VIEW_MODE`
//! at the App layer (Sprint 19); this component stays render-from-props +
//! optional `on_change` so the SSR tree stays headlessly testable.
//!
//! ARIA semantics preserved 1:1 with the React original:
//!   - `role="tablist"` on the container.
//!   - `role="tab"` + `aria-selected="true|false"` on each chip.
//!   - The active chip also carries `data-active="true"` so non-ARIA
//!     consumers (CSS / e2e) can query without parsing booleans.

use dioxus::prelude::*;

/// View modes shown on the toggle. Mirrors the `ViewMode` union from the
/// React source.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ViewMode {
    Graph,
    Board,
    Terminal,
}

impl ViewMode {
    fn key(self) -> &'static str {
        match self {
            ViewMode::Graph => "graph",
            ViewMode::Board => "board",
            ViewMode::Terminal => "terminal",
        }
    }

    fn label(self) -> &'static str {
        match self {
            ViewMode::Graph => "Graph",
            ViewMode::Board => "Board",
            ViewMode::Terminal => "Terminal",
        }
    }

    fn glyph(self) -> &'static str {
        // Same glyph set the React source uses; rendered as `aria-hidden`
        // so screen readers do not announce the box-drawing characters.
        match self {
            ViewMode::Graph => "\u{229F}",    // ⊟
            ViewMode::Board => "\u{2564}",    // ╤
            ViewMode::Terminal => "\u{2328}", // ⌨
        }
    }
}

const TABS: [ViewMode; 3] = [ViewMode::Graph, ViewMode::Board, ViewMode::Terminal];

#[component]
pub fn ViewToggle(
    /// Currently selected view.
    current: ViewMode,
    /// Optional `(new_mode)` callback. Left unconnected by SSR tests.
    on_change: Option<EventHandler<ViewMode>>,
) -> Element {
    rsx! {
        div {
            class: "view-toggle",
            "data-testid": "view-toggle",
            role: "tablist",
            for tab in TABS {
                {
                    let key = tab.key();
                    let label = tab.label();
                    let glyph = tab.glyph();
                    let active = tab == current;
                    let active_str = if active { "true" } else { "false" };
                    let testid = format!("view-toggle-{key}");
                    let mut class = String::from("view-toggle-tab");
                    if active {
                        class.push_str(" view-toggle-tab--active");
                    }
                    let handler = on_change;
                    rsx! {
                        button {
                            key: "{key}",
                            r#type: "button",
                            class: "{class}",
                            "data-testid": "{testid}",
                            "data-active": "{active_str}",
                            role: "tab",
                            "aria-selected": "{active_str}",
                            onclick: move |_| {
                                if let Some(h) = &handler {
                                    h.call(tab);
                                }
                            },
                            span { class: "view-toggle-glyph", "aria-hidden": "true", "{glyph}" }
                            span { class: "view-toggle-label", "{label}" }
                        }
                    }
                }
            }
        }
    }
}
