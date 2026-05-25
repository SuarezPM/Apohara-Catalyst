//! Root overlay wrappers (W3.D). Each reads its `GlobalSignal` and renders the
//! matching component; `App` mounts all three above the layout shell.
//!
//! These are pure (signal -> render) so they stay SSR-testable. The global
//! Cmd+K shortcut that opens the palette lives on the desktop event loop
//! (`main::DesktopRoot`), not here, so these never touch a desktop-only hook.

use dioxus::prelude::*;

use crate::components::dialogs::PermissionScope as DialogScope;
use crate::components::polish::Toast;
use crate::components::{CommandPalette, PermissionDialog};
use crate::layout::left_pane;
use crate::state::code_diff;
use crate::state::command_palette;
use crate::state::objective_input;
use crate::state::permissions::{
    self, PermissionDecision, PermissionResponseEvent, PermissionScope as StateScope,
};
use crate::state::selected_task;
use crate::state::toast_queue::{self, Toast as ToastModel, ToastLevel, TOAST_QUEUE};
use crate::state::view_mode::{set_view_mode, ViewMode, VIEW_MODE};

// --- CommandPalette (W3.D.1) ------------------------------------------

/// The 5 command-palette entries as `(id, label)`.
pub(crate) fn palette_commands() -> Vec<(String, String)> {
    vec![
        ("run".into(), "Run".into()),
        ("load-spec".into(), "Load SPEC".into()),
        ("switch-view".into(), "Switch View".into()),
        ("clear".into(), "Clear".into()),
        ("install-providers".into(), "Install providers".into()),
    ]
}

/// Cycle Graph -> Board -> Terminal -> Graph for the "Switch View" command.
fn next_view(current: ViewMode) -> ViewMode {
    match current {
        ViewMode::Graph => ViewMode::Board,
        ViewMode::Board => ViewMode::Terminal,
        ViewMode::Terminal => ViewMode::Graph,
    }
}

/// Toast surfaced by the "Install providers" command. Linking to docs needs the
/// system opener; for now the hint is a toast (no extra dependency).
fn install_hint_toast() -> ToastModel {
    ToastModel {
        id: "install-providers-hint".into(),
        level: ToastLevel::Info,
        message: "Install a CLI on PATH: claude / codex / opencode. See README \u{2192} Quick start."
            .into(),
        created_at: std::time::Instant::now(),
        ttl_ms: 8000,
    }
}

/// Dispatch a palette command by id, then close the palette.
pub(crate) fn run_command(id: String) {
    match id.as_str() {
        "run" => left_pane::run_objective(objective_input::get()),
        "load-spec" => left_pane::load_spec(objective_input::get()),
        "switch-view" => set_view_mode(next_view(*VIEW_MODE.read())),
        "clear" => {
            objective_input::set(String::new());
            code_diff::clear();
            selected_task::clear();
        }
        "install-providers" => toast_queue::push(install_hint_toast()),
        _ => {}
    }
    command_palette::close();
}

#[component]
pub fn CommandPaletteOverlay() -> Element {
    rsx! {
        CommandPalette {
            commands: palette_commands(),
            query: String::new(),
            visible: command_palette::is_open(),
            on_select: run_command,
        }
    }
}

// --- ToastContainer (W3.D.2) ------------------------------------------

/// Map a toast severity to the `Toast` component's free-form `kind` string.
fn toast_kind(level: ToastLevel) -> &'static str {
    match level {
        ToastLevel::Info => "info",
        ToastLevel::Success => "success",
        ToastLevel::Warning => "warning",
        ToastLevel::Error => "error",
    }
}

#[component]
pub fn ToastContainer() -> Element {
    let toasts: Vec<ToastModel> = TOAST_QUEUE.read().iter().cloned().collect();
    rsx! {
        div { class: "toast-container", "data-testid": "toast-container",
            for t in toasts {
                Toast {
                    key: "{t.id}",
                    message: t.message.clone(),
                    kind: toast_kind(t.level).to_string(),
                }
            }
        }
    }
}

// --- PermissionDialog (W3.D.3) ----------------------------------------

fn to_state_scope(scope: DialogScope) -> StateScope {
    match scope {
        DialogScope::Once => StateScope::Once,
        DialogScope::Session => StateScope::Session,
        DialogScope::Always => StateScope::Always,
    }
}

fn to_dialog_scope(scope: StateScope) -> DialogScope {
    match scope {
        StateScope::Once => DialogScope::Once,
        StateScope::Session => DialogScope::Session,
        StateScope::Always => DialogScope::Always,
    }
}

/// Record an Allow decision for `request_id` with the chosen scope.
pub(crate) fn allow_permission(request_id: String, scope: DialogScope) {
    permissions::record_permission_response(PermissionResponseEvent {
        request_id,
        decision: PermissionDecision::Allow,
        scope: Some(to_state_scope(scope)),
        pattern: None,
        ts: 0,
    });
}

/// Record a Deny decision for `request_id`.
pub(crate) fn deny_permission(request_id: String) {
    permissions::record_permission_response(PermissionResponseEvent {
        request_id,
        decision: PermissionDecision::Deny,
        scope: None,
        pattern: None,
        ts: 0,
    });
}

#[component]
pub fn PermissionDialogOverlay() -> Element {
    // Show the head unresolved request; the arbitrator coroutine (W4.2) drives
    // one-at-a-time resolution.
    let pending = permissions::unresolved_requests();
    let Some(req) = pending.into_iter().next() else {
        return rsx! {};
    };
    let scopes: Vec<DialogScope> = req
        .available_scopes
        .iter()
        .copied()
        .map(to_dialog_scope)
        .collect();
    let id_allow = req.request_id.clone();
    let id_deny = req.request_id.clone();
    rsx! {
        PermissionDialog {
            command: req.suggested_pattern.clone(),
            runner_kind: req.tool.clone(),
            visible: true,
            available_scopes: scopes,
            on_allow: move |scope| allow_permission(id_allow.clone(), scope),
            on_deny: move |_| deny_permission(id_deny.clone()),
        }
    }
}

#[cfg(test)]
mod overlays_test;
