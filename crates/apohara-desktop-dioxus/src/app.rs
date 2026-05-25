//! Root `App` component for the Dioxus desktop shell.

use dioxus::prelude::*;

use crate::layout::MainLayout;

const BRAND_CSS: &str = include_str!("../assets/brand.css");

/// Root component: brand stylesheet + the 3-pane `MainLayout` shell + the three
/// root overlay slots (CommandPalette / ToastContainer / PermissionDialog).
///
/// The overlays are placeholder slots for now; W3.D.1 / W3.D.2 / W3.D.3 swap in
/// the real components once their signals and props are wired. Keeping them as
/// dedicated slots here means those tasks change one component each without
/// touching the shell.
#[component]
pub fn App() -> Element {
    rsx! {
        div { id: "apohara-app",
            style { "{BRAND_CSS}" }
            MainLayout {}
            // Root overlay slots (wired in W3.D).
            div { class: "overlay-slot", "data-testid": "overlay-command-palette" }
            div { class: "overlay-slot", "data-testid": "overlay-toast-container" }
            div { class: "overlay-slot", "data-testid": "overlay-permission-dialog" }
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
