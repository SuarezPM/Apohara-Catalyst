//! Root `App` component for the Dioxus desktop shell.

use dioxus::prelude::*;

use crate::layout::MainLayout;
use crate::overlays::{CommandPaletteOverlay, PermissionDialogOverlay, ToastContainer};

const BRAND_CSS: &str = include_str!("../assets/brand.css");

/// Root component: brand stylesheet + the 3-pane `MainLayout` shell + the three
/// root overlays (CommandPalette / ToastContainer / PermissionDialog), each
/// reading its own `GlobalSignal` (W3.D). The global Cmd+K shortcut that opens
/// the palette is registered on the desktop event loop in `main::DesktopRoot`,
/// not here, so `App` stays headlessly SSR-testable.
#[component]
pub fn App() -> Element {
    rsx! {
        div { id: "apohara-app",
            style { "{BRAND_CSS}" }
            MainLayout {}
            CommandPaletteOverlay {}
            ToastContainer {}
            PermissionDialogOverlay {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::App;
    use dioxus::prelude::*;

    #[test]
    fn app_renders_shell_without_panic() {
        let html = dioxus_ssr::render_element(rsx! { App {} });
        assert!(html.contains("apohara-grid"), "shell grid missing: {html}");
        assert!(html.contains("apohara-app"), "app root missing: {html}");
    }
}
