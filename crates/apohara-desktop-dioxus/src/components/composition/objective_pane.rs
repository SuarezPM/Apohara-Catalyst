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
    /// and both buttons when true.
    active: bool,
    /// Execution mode. Surfaced on the root via `data-mode`.
    mode: ObjectiveMode,
    /// Comma-separated active provider ids. Stored on the root via
    /// `data-roster`; Sprint 19 reads it inside the wired callbacks.
    roster_csv: String,
    /// Optional callback fired with the current prompt when the user
    /// clicks Enhance. Left unconnected by SSR tests; the App wrapper
    /// will dispatch the Tauri command.
    on_enhance: Option<EventHandler<String>>,
    /// Optional callback fired with the prompt (or the enhanced version,
    /// once Sprint 19 wires it back into local state) when Run is clicked.
    on_run: Option<EventHandler<String>>,
) -> Element {
    let prompt = use_signal(String::new);
    let mode_key = mode.key();
    let active_attr = if active { "true" } else { "false" };
    let disabled = active;

    let prompt_for_enhance = prompt;
    let handler_enhance = on_enhance;
    let prompt_for_run = prompt;
    let handler_run = on_run;

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
                value: "{prompt}",
                oninput: move |evt| prompt.clone().set(evt.value()),
            }

            div {
                class: "objective-pane-actions",
                button {
                    r#type: "button",
                    class: "btn btn-secondary",
                    "data-testid": "objective-enhance",
                    disabled,
                    onclick: move |_| {
                        if let Some(h) = &handler_enhance {
                            h.call(prompt_for_enhance.read().clone());
                        }
                    },
                    "Enhance \u{25BE}"
                }
                button {
                    r#type: "button",
                    class: "btn btn-primary",
                    "data-testid": "objective-run",
                    disabled,
                    onclick: move |_| {
                        if let Some(h) = &handler_run {
                            h.call(prompt_for_run.read().clone());
                        }
                    },
                    "Run \u{25B6}"
                }
            }
        }
    }
}
