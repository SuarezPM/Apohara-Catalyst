//! SSR tests for the Wave B polish components (G2.C.2.2–G2.C.2.4).
//!
//! Each component gets its own `mod` block so failures point at a
//! single visual primitive. CommandPalette has its own dedicated test
//! file (`command_palette_test.rs`) because it landed in its own
//! commit ahead of the rest of the suite.

#[cfg(test)]
mod resizable_tests {
    use crate::components::polish::Resizable;
    use dioxus::prelude::*;

    #[test]
    fn resizable_renders_children_and_handle() {
        let html = dioxus_ssr::render_element(rsx! {
            Resizable { initial_width: 320, "panel-body" }
        });
        assert!(html.contains("panel-body"), "children missing: {html}");
        assert!(
            html.contains("resizable-panel"),
            "panel class missing: {html}"
        );
        assert!(
            html.contains("resizable-handle"),
            "drag handle missing: {html}"
        );
    }

    #[test]
    fn resizable_emits_initial_width_inline_style() {
        let html = dioxus_ssr::render_element(rsx! {
            Resizable { initial_width: 480, "x" }
        });
        assert!(
            html.contains("width: 480px"),
            "inline initial width missing: {html}"
        );
    }

    #[test]
    fn resizable_handle_has_separator_role_for_a11y() {
        let html = dioxus_ssr::render_element(rsx! {
            Resizable { initial_width: 240, "x" }
        });
        assert!(
            html.contains("role=\"separator\""),
            "ARIA separator role missing: {html}"
        );
        assert!(
            html.contains("aria-orientation=\"vertical\""),
            "aria-orientation missing: {html}"
        );
    }
}

#[cfg(test)]
mod tooltip_tests {
    use crate::components::polish::Tooltip;
    use dioxus::prelude::*;

    #[test]
    fn tooltip_wraps_children() {
        let html = dioxus_ssr::render_element(rsx! {
            Tooltip { label: "Save the file".to_string(), "Save" }
        });
        assert!(html.contains("Save"), "trigger children missing: {html}");
        assert!(
            html.contains("tooltip-wrapper"),
            "wrapper class missing: {html}"
        );
    }

    #[test]
    fn tooltip_renders_label_text() {
        let html = dioxus_ssr::render_element(rsx! {
            Tooltip { label: "Run apohara doctor".to_string(), "doc" }
        });
        assert!(
            html.contains("Run apohara doctor"),
            "label text missing: {html}"
        );
        assert!(html.contains("class=\"tooltip\""), "tooltip class missing: {html}");
    }

    #[test]
    fn tooltip_label_uses_tooltip_role_for_a11y() {
        let html = dioxus_ssr::render_element(rsx! {
            Tooltip { label: "Hi".to_string(), "x" }
        });
        assert!(
            html.contains("role=\"tooltip\""),
            "ARIA role=tooltip missing: {html}"
        );
    }
}

#[cfg(test)]
mod toast_tests {
    use crate::components::polish::Toast;
    use dioxus::prelude::*;

    #[test]
    fn toast_renders_message_and_kind() {
        let html = dioxus_ssr::render_element(rsx! {
            Toast { message: "Saved".to_string(), kind: "success".to_string() }
        });
        assert!(html.contains("Saved"), "message missing: {html}");
        assert!(
            html.contains("toast-success"),
            "kind class missing: {html}"
        );
    }

    #[test]
    fn toast_has_aria_role_status_for_a11y() {
        let html = dioxus_ssr::render_element(rsx! {
            Toast { message: "Hi".to_string(), kind: "info".to_string() }
        });
        assert!(
            html.contains("role=\"status\""),
            "role=status missing: {html}"
        );
        assert!(
            html.contains("aria-live=\"polite\""),
            "aria-live missing: {html}"
        );
    }

    #[test]
    fn toast_renders_error_kind_class() {
        let html = dioxus_ssr::render_element(rsx! {
            Toast { message: "Boom".to_string(), kind: "error".to_string() }
        });
        assert!(html.contains("toast-error"), "error class missing: {html}");
    }

    #[test]
    fn toast_base_class_always_present() {
        let html = dioxus_ssr::render_element(rsx! {
            Toast { message: "x".to_string(), kind: "info".to_string() }
        });
        assert!(html.contains("class=\"toast"), "base class missing: {html}");
    }
}
