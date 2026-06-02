//! Apohara Desktop (Dioxus rewrite) — binary entry point.

use apohara_desktop_dioxus::state::command_palette;
use apohara_desktop_dioxus::App;
use apohara_mcp::api::mcp_bootstrap_servers_inner;
use dioxus::desktop::{use_global_shortcut, Config, HotKeyState, WindowBuilder};
use dioxus::prelude::*;

fn main() {
    tracing_subscriber::fmt::init();
    let cfg = Config::new().with_window(WindowBuilder::new().with_title("Apohara Catalyst"));
    LaunchBuilder::desktop().with_cfg(cfg).launch(DesktopRoot);
}

/// Desktop root: registers the global Cmd/Ctrl+K shortcut that toggles the
/// command palette (R5: desktop event loop, not an HTML `onkeydown`), boots the
/// internal MCP bus once on mount, then renders the SSR-testable `App`. Both
/// desktop-only side effects live here — never in `App` — so the component tree
/// stays renderable under `dioxus_ssr` in tests.
#[component]
fn DesktopRoot() -> Element {
    let _ = use_global_shortcut("CmdOrCtrl+K", |state| {
        if state == HotKeyState::Pressed {
            command_palette::toggle();
        }
    });
    // Bootstrap the internal MCP bus once on mount (US-F0.1). Idempotent at the
    // crate level, so even a re-mount won't start a second set of servers. A
    // bootstrap failure must NOT panic the UI — log and carry on.
    use_future(|| async {
        match mcp_bootstrap_servers_inner().await {
            Ok(endpoint) => {
                tracing::info!(token = %endpoint.token, "MCP bus bootstrapped");
            }
            Err(err) => {
                tracing::warn!(%err, "MCP bus bootstrap failed; continuing without it");
            }
        }
    });
    rsx! { App {} }
}
