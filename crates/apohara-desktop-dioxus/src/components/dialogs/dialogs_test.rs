//! SSR tests for the dialog ports (G2.B.4).
//!
//! Reference: `packages/desktop/src/components/PermissionDialog.tsx`.

use super::permission_dialog::{PermissionDialog, PermissionScope};
use super::toast_dialog::ToastDialog;
use dioxus::prelude::*;

#[test]
fn permission_dialog_hides_when_not_visible() {
    let html = dioxus_ssr::render_element(rsx! {
        PermissionDialog {
            command: "rm -rf /tmp/test".to_string(),
            runner_kind: "Bash".to_string(),
            visible: false,
            available_scopes: vec![PermissionScope::Once],
        }
    });
    assert!(
        !html.contains("permission-dialog"),
        "expected hidden when visible=false, got: {html}"
    );
}

#[test]
fn permission_dialog_renders_command_and_runner_kind() {
    let html = dioxus_ssr::render_element(rsx! {
        PermissionDialog {
            command: "rm -rf /tmp/test".to_string(),
            runner_kind: "Bash".to_string(),
            visible: true,
            available_scopes: vec![PermissionScope::Once],
        }
    });
    assert!(
        html.contains("rm -rf /tmp/test"),
        "command missing: {html}"
    );
    assert!(html.contains("Bash"), "runner kind missing: {html}");
    assert!(
        html.contains("permission-dialog"),
        "permission-dialog class missing: {html}"
    );
    assert!(
        html.contains("dialog-backdrop"),
        "backdrop missing: {html}"
    );
    assert!(
        html.contains("role=\"dialog\""),
        "ARIA role missing: {html}"
    );
    assert!(
        html.contains("aria-modal=\"true\""),
        "aria-modal missing: {html}"
    );
}

#[test]
fn permission_dialog_renders_all_scope_buttons() {
    let html = dioxus_ssr::render_element(rsx! {
        PermissionDialog {
            command: "git push".to_string(),
            runner_kind: "Bash".to_string(),
            visible: true,
            available_scopes: vec![
                PermissionScope::Once,
                PermissionScope::Session,
                PermissionScope::Always,
            ],
        }
    });
    assert!(html.contains("Allow once"), "once button missing: {html}");
    assert!(
        html.contains("Allow session"),
        "session button missing: {html}"
    );
    assert!(
        html.contains("Allow always"),
        "always button missing: {html}"
    );
    assert!(html.contains("Deny"), "deny button missing: {html}");
    assert!(
        html.contains("dialog-allow-once"),
        "once testid missing: {html}"
    );
    assert!(
        html.contains("dialog-allow-session"),
        "session testid missing: {html}"
    );
    assert!(
        html.contains("dialog-allow-always"),
        "always testid missing: {html}"
    );
    assert!(
        html.contains("dialog-deny"),
        "deny testid missing: {html}"
    );
}

#[test]
fn permission_dialog_renders_only_available_scopes() {
    // available_scopes is the source of truth — buttons only show for what
    // the safety layer says is allowed. Mirrors React's `.map` over
    // `current.available_scopes`.
    let html = dioxus_ssr::render_element(rsx! {
        PermissionDialog {
            command: "echo hi".to_string(),
            runner_kind: "Bash".to_string(),
            visible: true,
            available_scopes: vec![PermissionScope::Once],
        }
    });
    assert!(html.contains("Allow once"));
    assert!(
        !html.contains("Allow session"),
        "session button must be hidden when scope absent: {html}"
    );
    assert!(
        !html.contains("Allow always"),
        "always button must be hidden when scope absent: {html}"
    );
}

#[test]
fn toast_dialog_renders_container_with_data_toast() {
    let html = dioxus_ssr::render_element(rsx! {
        ToastDialog {}
    });
    assert!(
        html.contains("data-toast"),
        "data-toast attribute missing: {html}"
    );
    assert!(
        html.contains("toast-container"),
        "toast-container class missing: {html}"
    );
    // Stub: no items yet. Sprint 18 wires Sonner-equivalent feed.
}

#[test]
fn toast_dialog_has_aria_live_for_a11y() {
    // Toast surfaces are screen-reader announcements; aria-live=polite is
    // the conventional baseline. Sprint 18 may upgrade to assertive per
    // toast severity, but the container itself stays polite.
    let html = dioxus_ssr::render_element(rsx! {
        ToastDialog {}
    });
    assert!(
        html.contains("aria-live=\"polite\""),
        "aria-live missing: {html}"
    );
}
