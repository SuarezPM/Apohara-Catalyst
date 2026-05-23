//! SSR tests for the HeroBanner port (G2.A.4).
//!
//! Reference: `packages/desktop/src/components/HeroBanner.tsx`.

use super::hero_banner::HeroBanner;
use dioxus::prelude::*;

#[test]
fn hides_when_session_id_is_some() {
    let html = dioxus_ssr::render_element(rsx! {
        HeroBanner {
            session_id: Some("run-1".to_string()),
            tasks_empty: true,
            tagline: "ignored".to_string(),
            on_seed_demo: None,
        }
    });
    assert!(
        !html.contains("hero-banner"),
        "expected hidden when session_id is Some, got: {html}"
    );
}

#[test]
fn hides_when_tasks_not_empty() {
    let html = dioxus_ssr::render_element(rsx! {
        HeroBanner {
            session_id: None,
            tasks_empty: false,
            tagline: "ignored".to_string(),
            on_seed_demo: None,
        }
    });
    assert!(
        !html.contains("hero-banner"),
        "expected hidden when tasks present, got: {html}"
    );
}

#[test]
fn renders_wordmark_with_lime_token_and_brand_class() {
    let html = dioxus_ssr::render_element(rsx! {
        HeroBanner {
            session_id: None,
            tasks_empty: true,
            tagline: "Three sanctioned CLI drivers.".to_string(),
            on_seed_demo: None,
        }
    });
    assert!(html.contains("APOHARA CATALYST"), "wordmark missing: {html}");
    assert!(html.contains("font-display"), "Press-Start-2P class missing");
    assert!(html.contains("--apohara-lime"), "lime CSS token missing");
    assert!(
        html.contains("hero-banner-tagline"),
        "tagline testid missing"
    );
    assert!(
        html.contains("Three sanctioned CLI drivers."),
        "tagline text missing"
    );
}

#[test]
fn docs_link_present_with_target_blank() {
    let html = dioxus_ssr::render_element(rsx! {
        HeroBanner {
            session_id: None,
            tasks_empty: true,
            tagline: "tagline".to_string(),
            on_seed_demo: None,
        }
    });
    assert!(
        html.contains("hero-banner-docs-link"),
        "docs link testid missing: {html}"
    );
    assert!(html.contains("target=\"_blank\""));
}

#[test]
fn seed_cta_renders_when_callback_provided() {
    // EventHandler::new requires a Dioxus runtime; build one via VirtualDom
    // and render through `dioxus_ssr::render`.
    #[allow(non_snake_case)]
    fn TestApp() -> Element {
        rsx! {
            HeroBanner {
                session_id: None,
                tasks_empty: true,
                tagline: "tagline".to_string(),
                on_seed_demo: Some(EventHandler::new(|_| {})),
            }
        }
    }
    let mut vdom = VirtualDom::new(TestApp);
    vdom.rebuild_in_place();
    let html = dioxus_ssr::render(&vdom);
    assert!(html.contains("hero-banner-seed-cta"), "seed CTA missing: {html}");
    assert!(html.contains("Try the demo"), "CTA label missing");
}

#[test]
fn seed_cta_absent_without_callback() {
    let html = dioxus_ssr::render_element(rsx! {
        HeroBanner {
            session_id: None,
            tasks_empty: true,
            tagline: "tagline".to_string(),
            on_seed_demo: None,
        }
    });
    assert!(
        !html.contains("hero-banner-seed-cta"),
        "seed CTA should be hidden without callback: {html}"
    );
}
