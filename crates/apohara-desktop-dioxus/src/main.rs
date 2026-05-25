//! Apohara Desktop (Dioxus rewrite) — binary entry point.

use apohara_desktop_dioxus::state::command_palette;
use apohara_desktop_dioxus::App;
use dioxus::desktop::{use_global_shortcut, Config, HotKeyState, WindowBuilder};
use dioxus::prelude::*;

fn main() {
    tracing_subscriber::fmt::init();
    let cfg = Config::new().with_window(WindowBuilder::new().with_title("Apohara Catalyst"));
    LaunchBuilder::desktop().with_cfg(cfg).launch(DesktopRoot);
}

/// Desktop root: registers the global Cmd/Ctrl+K shortcut that toggles the
/// command palette (R5: desktop event loop, not an HTML `onkeydown`), then
/// renders the SSR-testable `App`. The shortcut hook lives here — never in
/// `App` — so the component tree stays renderable under `dioxus_ssr` in tests.
#[component]
fn DesktopRoot() -> Element {
    let _ = use_global_shortcut("CmdOrCtrl+K", |state| {
        if state == HotKeyState::Pressed {
            command_palette::toggle();
        }
    });
    rsx! { App {} }
}
