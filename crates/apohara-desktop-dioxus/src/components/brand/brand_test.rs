//! SSR tests for the brand-effect ports (G2.B.2).
//!
//! Reference: `packages/desktop/src/components/AgentStateDot.tsx`.

use super::{AgentStateDot, PixelCanvas, RunningBorder};
use dioxus::prelude::*;

// ============================================================================
// AgentStateDot — Sprint 17 G2.B.2 step 1
// ============================================================================

#[test]
fn agent_state_dot_renders_working_with_lime_and_pulse() {
    let html = dioxus_ssr::render_element(rsx! {
        AgentStateDot { state: "working".to_string() }
    });
    assert!(
        html.contains("data-state-dot"),
        "data-state-dot marker missing: {html}"
    );
    assert!(
        html.contains("data-state=\"working\""),
        "working data-state missing: {html}"
    );
    assert!(html.contains("dot-working"), "dot-working class missing: {html}");
    assert!(html.contains("--apohara-lime"), "lime token missing: {html}");
}

#[test]
fn agent_state_dot_idle_uses_muted_class() {
    let html = dioxus_ssr::render_element(rsx! {
        AgentStateDot { state: "idle".to_string() }
    });
    assert!(html.contains("dot-idle"), "dot-idle class missing: {html}");
    assert!(
        html.contains("data-state=\"idle\""),
        "idle data-state missing: {html}"
    );
}

#[test]
fn agent_state_dot_size_sm_renders_8px() {
    let html = dioxus_ssr::render_element(rsx! {
        AgentStateDot { state: "idle".to_string(), size: "sm".to_string() }
    });
    assert!(html.contains("width: 8px"), "sm width missing: {html}");
    assert!(html.contains("height: 8px"), "sm height missing: {html}");
}

#[test]
fn agent_state_dot_default_size_is_md_12px() {
    let html = dioxus_ssr::render_element(rsx! {
        AgentStateDot { state: "idle".to_string() }
    });
    assert!(html.contains("width: 12px"), "md default width missing: {html}");
    assert!(html.contains("height: 12px"), "md default height missing: {html}");
}

#[test]
fn agent_state_dot_uses_custom_label_when_provided() {
    let html = dioxus_ssr::render_element(rsx! {
        AgentStateDot {
            state: "working".to_string(),
            label: "verifier busy".to_string(),
        }
    });
    assert!(
        html.contains("aria-label=\"verifier busy\""),
        "custom aria-label missing: {html}"
    );
}

#[test]
fn agent_state_dot_falls_back_to_state_label() {
    let html = dioxus_ssr::render_element(rsx! {
        AgentStateDot { state: "done".to_string() }
    });
    assert!(
        html.contains("aria-label=\"agent done\""),
        "default aria-label missing: {html}"
    );
}

// ============================================================================
// RunningBorder — Sprint 17 G2.B.2 step 2
// ============================================================================

#[test]
fn running_border_applies_class_when_active() {
    #[allow(non_snake_case)]
    fn TestApp() -> Element {
        rsx! {
            RunningBorder { active: true,
                span { "child" }
            }
        }
    }
    let mut vdom = VirtualDom::new(TestApp);
    vdom.rebuild_in_place();
    let html = dioxus_ssr::render(&vdom);
    assert!(
        html.contains("running-border"),
        "running-border class missing when active: {html}"
    );
    assert!(html.contains("child"), "child content missing: {html}");
}

#[test]
fn running_border_omits_class_when_inactive() {
    #[allow(non_snake_case)]
    fn TestApp() -> Element {
        rsx! {
            RunningBorder { active: false,
                span { "child" }
            }
        }
    }
    let mut vdom = VirtualDom::new(TestApp);
    vdom.rebuild_in_place();
    let html = dioxus_ssr::render(&vdom);
    assert!(
        !html.contains("running-border"),
        "running-border class should not appear when inactive: {html}"
    );
    assert!(html.contains("child"), "child content missing: {html}");
}

// ============================================================================
// PixelCanvas — Sprint 17 G2.B.2 step 3
// ============================================================================

#[test]
fn pixel_canvas_renders_canvas_with_default_size() {
    let html = dioxus_ssr::render_element(rsx! {
        PixelCanvas {
            sprite_url: "/assets/chief.png".to_string(),
            frame: "idle".to_string(),
        }
    });
    assert!(html.contains("<canvas"), "canvas element missing: {html}");
    assert!(
        html.contains("data-pixel-canvas"),
        "data-pixel-canvas marker missing: {html}"
    );
    assert!(
        html.contains("data-frame=\"idle\""),
        "data-frame attribute missing: {html}"
    );
    assert!(
        html.contains("width=\"64\""),
        "default width 64 missing: {html}"
    );
    assert!(
        html.contains("height=\"64\""),
        "default height 64 missing: {html}"
    );
}

#[test]
fn pixel_canvas_honors_custom_size_and_frame() {
    let html = dioxus_ssr::render_element(rsx! {
        PixelCanvas {
            sprite_url: "/sprites/chief.png".to_string(),
            frame: "working".to_string(),
            size: 96,
        }
    });
    assert!(html.contains("width=\"96\""), "custom width missing: {html}");
    assert!(html.contains("height=\"96\""), "custom height missing: {html}");
    assert!(
        html.contains("data-frame=\"working\""),
        "working frame missing: {html}"
    );
}

#[test]
fn pixel_canvas_exposes_sprite_url_for_runtime_hydration() {
    let html = dioxus_ssr::render_element(rsx! {
        PixelCanvas {
            sprite_url: "/sprites/chief.png".to_string(),
            frame: "happy".to_string(),
        }
    });
    assert!(
        html.contains("data-sprite-url=\"/sprites/chief.png\""),
        "sprite url not exposed for runtime draw: {html}"
    );
}

#[test]
fn pixel_canvas_pixelated_rendering_style_applied() {
    let html = dioxus_ssr::render_element(rsx! {
        PixelCanvas {
            sprite_url: "/sprites/chief.png".to_string(),
            frame: "idle".to_string(),
        }
    });
    assert!(
        html.contains("image-rendering: pixelated"),
        "pixelated rendering hint missing: {html}"
    );
}

#[test]
fn pixel_canvas_exposes_metadata_url_when_provided() {
    let html = dioxus_ssr::render_element(rsx! {
        PixelCanvas {
            sprite_url: "/sprites/chief.png".to_string(),
            metadata_url: "/sprites/chief.meta.json".to_string(),
            frame: "thinking".to_string(),
        }
    });
    assert!(
        html.contains("data-metadata-url=\"/sprites/chief.meta.json\""),
        "metadata url not exposed: {html}"
    );
}
