//! PermissionDialog — modal that asks the user to approve / deny a tool
//! invocation about to run under the safety layer.
//!
//! Direct port of `packages/desktop/src/components/PermissionDialog.tsx`.
//! Render-only in Sprint 17. Sprint 18 (G2.C) wires the real handlers to
//! `apohara_safety::tauri_bridge::safety_check_permission` and the
//! response ledger; for now `on_allow` / `on_deny` are plain EventHandlers
//! so callers can stub them out.
//!
//! Design intent preserved from React:
//!   - Backdrop covers the whole viewport and blocks input.
//!   - Inner card shows runner kind + command + per-scope allow buttons +
//!     a single deny button.
//!   - Scopes are sourced from `available_scopes` (the safety layer
//!     decides what the user is allowed to pick — never hardcode the
//!     button set).
//!   - When `visible` is false the dialog is rendered as an empty
//!     fragment (parent owns the show/hide state).
//!
//! ARIA: `role="dialog"` + `aria-modal="true"` so assistive tech treats
//! the backdrop as a true modal and traps focus inside the card.

use dioxus::prelude::*;

/// Scopes the user can grant when allowing a permission request. Mirrors
/// the TS `PermissionScope` union (`once | session | always`).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PermissionScope {
    Once,
    Session,
    Always,
}

impl PermissionScope {
    /// Lowercase label used in the button text and the test-id suffix.
    /// Matches the React component's template strings.
    fn label(self) -> &'static str {
        match self {
            PermissionScope::Once => "once",
            PermissionScope::Session => "session",
            PermissionScope::Always => "always",
        }
    }
}

#[component]
pub fn PermissionDialog(
    /// Command (or rendered argument summary) that the user is being
    /// asked to approve.
    command: String,
    /// Runner kind that would execute the command (e.g. `Bash`, `Write`,
    /// `Edit`). Surfaced as a badge so the user knows the blast radius.
    runner_kind: String,
    /// Whether the dialog should render. Empty fragment when false.
    visible: bool,
    /// Scopes the safety layer says are admissible for this request.
    /// Buttons are rendered in the order supplied.
    available_scopes: Vec<PermissionScope>,
    /// Fired with the chosen scope when the user clicks an Allow button.
    /// Optional so render-only tests can omit it.
    on_allow: Option<EventHandler<PermissionScope>>,
    /// Fired when the user clicks Deny.
    on_deny: Option<EventHandler<()>>,
) -> Element {
    if !visible {
        return rsx! {};
    }

    rsx! {
        div {
            class: "dialog-backdrop",
            "data-testid": "permission-dialog-backdrop",
            div {
                class: "card dialog permission-dialog",
                "data-testid": "permission-dialog",
                role: "dialog",
                "aria-modal": "true",
                "aria-label": "Permission requested",
                h3 {
                    class: "press-start-2p dialog-title",
                    "Permission required"
                }
                p {
                    class: "dialog-runner",
                    "Runner: "
                    span {
                        class: "badge",
                        "data-testid": "dialog-runner-kind",
                        "{runner_kind}"
                    }
                }
                pre {
                    class: "dialog-command",
                    "data-testid": "dialog-command",
                    "{command}"
                }
                div {
                    class: "dialog-actions",
                    for scope in available_scopes.iter().copied() {
                        button {
                            key: "{scope.label()}",
                            r#type: "button",
                            class: "btn btn-primary",
                            "data-testid": "dialog-allow-{scope.label()}",
                            onclick: move |_| {
                                if let Some(handler) = &on_allow {
                                    handler.call(scope);
                                }
                            },
                            "Allow {scope.label()}"
                        }
                    }
                    button {
                        r#type: "button",
                        class: "btn btn-danger",
                        "data-testid": "dialog-deny",
                        onclick: move |_| {
                            if let Some(handler) = &on_deny {
                                handler.call(());
                            }
                        },
                        "Deny"
                    }
                }
            }
        }
    }
}
