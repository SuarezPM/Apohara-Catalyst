//! Root `App` component for the Dioxus desktop bake-off.

use dioxus::prelude::*;

const BRAND_CSS: &str = include_str!("../assets/brand.css");

/// Root component. Mounts the brand stylesheet and a stub layout.
///
/// G2.A.1: hello world.
/// G2.A.4: HeroBanner mounted via `components::HeroBanner`.
#[component]
pub fn App() -> Element {
    rsx! {
        div { id: "apohara-app",
            style { "{BRAND_CSS}" }
            crate::components::HeroBanner {
                session_id: None,
                tasks_empty: true,
                tagline: "Three sanctioned CLI drivers (claude, codex, opencode), one ledger, zero cloud sync. Type a goal and Apohara plans, dispatches, and verifies — without leaking your API keys to any subprocess.".to_string(),
                on_seed_demo: None,
            }
        }
    }
}
