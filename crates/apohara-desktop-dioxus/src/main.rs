//! Apohara Desktop (Dioxus rewrite) — binary entry point.

use apohara_desktop_dioxus::state::command_palette;
use apohara_desktop_dioxus::App;
use dioxus::desktop::{use_global_shortcut, HotKeyState};
use dioxus::prelude::*;

fn main() {
    tracing_subscriber::fmt::init();
    dioxus::launch(DesktopRoot);
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
