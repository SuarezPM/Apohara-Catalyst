//! SSR tests for the root overlay wrappers (W3.D.1 / W3.D.2 / W3.D.3).

use dioxus::prelude::*;

#[test]
fn command_palette_overlay_renders_five_commands_when_open() {
    use crate::state::command_palette::open;
    #[allow(non_snake_case)]
    fn Harness() -> Element {
        use_hook(open);
        rsx! { super::CommandPaletteOverlay {} }
    }
    let mut vdom = VirtualDom::new(Harness);
    vdom.rebuild_in_place();
    let html = dioxus_ssr::render(&vdom);
    for id in ["run", "load-spec", "switch-view", "clear", "install-providers"] {
        assert!(
            html.contains(&format!("data-command-id=\"{id}\"")),
            "command {id} missing: {html}"
        );
    }
}

#[test]
fn command_palette_overlay_hidden_when_closed() {
    // Default COMMAND_PALETTE_OPEN is false -> empty fragment.
    let html = dioxus_ssr::render_element(rsx! { super::CommandPaletteOverlay {} });
    assert!(
        !html.contains("data-testid=\"command-palette\""),
        "palette should be hidden by default: {html}"
    );
}

#[test]
fn toast_container_renders_one_node_per_toast() {
    use crate::state::toast_queue::{push, Toast, ToastLevel};
    #[allow(non_snake_case)]
    fn Harness() -> Element {
        use_hook(|| {
            push(Toast {
                id: "a".into(),
                level: ToastLevel::Info,
                message: "first".into(),
                created_at: std::time::Instant::now(),
                ttl_ms: 5000,
            });
            push(Toast {
                id: "b".into(),
                level: ToastLevel::Error,
                message: "second".into(),
                created_at: std::time::Instant::now(),
                ttl_ms: 5000,
            });
        });
        rsx! { super::ToastContainer {} }
    }
    let mut vdom = VirtualDom::new(Harness);
    vdom.rebuild_in_place();
    let html = dioxus_ssr::render(&vdom);
    assert_eq!(
        html.matches("data-testid=\"toast\"").count(),
        2,
        "expected 2 toast nodes: {html}"
    );
    assert!(html.contains("first") && html.contains("second"));
}

#[test]
fn permission_dialog_overlay_shows_when_request_pending() {
    use crate::state::permissions::{
        enqueue_permission_request, PermissionRequestEvent, PermissionScope,
    };
    #[allow(non_snake_case)]
    fn Harness() -> Element {
        use_hook(|| {
            enqueue_permission_request(PermissionRequestEvent {
                request_id: "r1".into(),
                tool: "Bash".into(),
                suggested_pattern: "rm -rf /tmp/x".into(),
                available_scopes: vec![
                    PermissionScope::Once,
                    PermissionScope::Session,
                    PermissionScope::Always,
                ],
                ts: 0,
            })
        });
        rsx! { super::PermissionDialogOverlay {} }
    }
    let mut vdom = VirtualDom::new(Harness);
    vdom.rebuild_in_place();
    let html = dioxus_ssr::render(&vdom);
    assert!(
        html.contains("data-testid=\"permission-dialog\""),
        "dialog missing when a request is pending: {html}"
    );
    assert!(html.contains("Bash"), "runner kind missing: {html}");
    assert!(
        html.contains("dialog-allow-once"),
        "once allow button missing: {html}"
    );
}

#[test]
fn permission_dialog_overlay_empty_when_no_request() {
    let html = dioxus_ssr::render_element(rsx! { super::PermissionDialogOverlay {} });
    assert!(
        !html.contains("data-testid=\"permission-dialog\""),
        "dialog should be hidden with no pending request: {html}"
    );
}
