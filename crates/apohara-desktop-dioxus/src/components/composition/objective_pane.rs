//! ObjectivePane — Apohara Catalyst objective sidebar (G2.C.3.4).
//!
//! Direct port of `packages/desktop/src/components/ObjectivePane.tsx`. The
//! React original held local `useState` for prompt / enhanced / busy /
//! error and `fetch`-ed `/api/enhance` and `/api/run`. The Dioxus port:
//!   - Owns the prompt + enhanced/error/busy state as local `Signal`s so
//!     the controlled textarea round-trips inside the component.
//!   - Exposes `on_enhance(prompt)` and `on_run(prompt)` callbacks instead
//!     of calling `fetch` directly. Sprint 19 binds them to the Tauri
//!     commands defined in `crate::commands`.
//!
//! Props mirror the React shape:
//!   - `active`     — when true (a session is in flight), the inputs and
//!     buttons are disabled.
//!   - `mode`       — Gpu | Cloud. Surfaced on the root via `data-mode`
//!     so e2e can introspect without parsing internal state.
//!   - `roster_csv` — comma-separated provider list. Stored on the root as
//!     `data-roster` so the Sprint 19 callbacks can read it back without a
//!     prop drill into every handler.

use dioxus::prelude::*;

/// Execution mode selected at the top-level. Mirrors the TS union.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ObjectiveMode {
    Gpu,
    Cloud,
}

impl ObjectiveMode {
    fn key(self) -> &'static str {
        match self {
            ObjectiveMode::Gpu => "gpu",
            ObjectiveMode::Cloud => "cloud",
        }
    }
}

#[component]
pub fn ObjectivePane(
    /// Whether a session is currently running. Disables the prompt input
    /// and the buttons when true.
    active: bool,
    /// Execution mode. Surfaced on the root via `data-mode`.
    mode: ObjectiveMode,
    /// Comma-separated active provider ids. Stored on the root via
    /// `data-roster`; the wired callbacks read it back.
    roster_csv: String,
    /// Controlled value: when `Some`, the textarea reflects this (bound to a
    /// parent `GlobalSignal` such as `OBJECTIVE_INPUT`) and edits flow out via
    /// `on_input`. When `None`, the pane falls back to a component-local buffer
    /// so the prop-driven SSR tests keep working without a parent.
    value: Option<String>,
    /// Fired with the new text on every keystroke when the pane is controlled.
    on_input: Option<EventHandler<String>>,
    /// Optional callback fired with the current text when Enhance is clicked.
    on_enhance: Option<EventHandler<String>>,
    /// Optional callback fired with the current text when Run is clicked.
    on_run: Option<EventHandler<String>>,
    /// Optional callback fired with the current text when "Load SPEC" is
    /// clicked. The handler decomposes the text into the task graph (W3.A.4).
    on_load_spec: Option<EventHandler<String>>,
) -> Element {
    let local = use_signal(String::new);
    let mode_key = mode.key();
    let active_attr = if active { "true" } else { "false" };
    let disabled = active;

    // Controlled value (parent-owned signal) wins; else the local buffer.
    let text = value.unwrap_or_else(|| local.read().clone());

    rsx! {
        aside {
            class: "objective-pane",
            "data-testid": "objective-pane",
            "data-active": "{active_attr}",
            "data-mode": "{mode_key}",
            "data-roster": "{roster_csv}",
            "aria-label": "Objective",

            h2 { class: "press-start-2p objective-pane-title", "Objective" }

            textarea {
                class: "objective-pane-input",
                "data-testid": "objective-input",
                placeholder: "Describe what to build\u{2026}",
                rows: 8,
                disabled,
                value: "{text}",
                oninput: move |evt| {
                    let v = evt.value();
                    match on_input {
                        Some(h) => h.call(v),
                        None => {
                            local.clone().set(v);
                        }
                    }
                },
            }

            div {
                class: "objective-pane-actions",
                button {
                    r#type: "button",
                    class: "btn btn-secondary",
                    "data-testid": "objective-load-spec",
                    disabled,
                    onclick: {
                        let text = text.clone();
                        move |_| {
                            if let Some(h) = &on_load_spec {
                                h.call(text.clone());
                            }
                        }
                    },
                    "Load SPEC"
                }
                button {
                    r#type: "button",
                    class: "btn btn-secondary",
                    "data-testid": "objective-enhance",
                    disabled,
                    onclick: {
                        let text = text.clone();
                        move |_| {
                            if let Some(h) = &on_enhance {
                                h.call(text.clone());
                            }
                        }
                    },
                    "Enhance \u{25BE}"
                }
                button {
                    r#type: "button",
                    class: "btn btn-primary",
                    "data-testid": "objective-run",
                    disabled,
                    onclick: {
                        let text = text.clone();
                        move |_| {
                            if let Some(h) = &on_run {
                                h.call(text.clone());
                            }
                        }
                    },
                    "Run \u{25B6}"
                }
            }
        }
    }
}
