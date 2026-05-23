//! HeroBanner — placeholder for G2.A.1.
//!
//! Real implementation lands in G2.A.4 (port from
//! `packages/desktop/src/components/HeroBanner.tsx`).

use dioxus::prelude::*;

#[component]
pub fn HeroBanner(session_id: Option<String>, tagline: String) -> Element {
    if session_id.is_some() {
        return rsx! {};
    }
    rsx! {
        section { class: "hero-banner",
            h1 { class: "press-start-2p hero-title", "APOHARA CATALYST" }
            p { class: "hero-tagline", "{tagline}" }
        }
    }
}
