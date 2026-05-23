//! SSR tests for brand primitives (G2.B.1).
//!
//! Reference: `packages/desktop/src/components/ui/{Button,Input,Card}.tsx`.
//! Badge has no React precedent (see `mod.rs`), so its tests pin the brand
//! contract directly: a `.badge` span carrying its label.

#[cfg(test)]
mod button_tests {
    use crate::components::primitives::Button;
    use dioxus::prelude::*;

    #[test]
    fn renders_label_and_default_variant() {
        let html = dioxus_ssr::render_element(rsx! {
            Button { "Run" }
        });
        assert!(html.contains("Run"), "label missing: {html}");
        assert!(
            html.contains("btn-primary"),
            "default variant class missing: {html}"
        );
        assert!(html.contains("class=\"btn"), "btn base class missing: {html}");
    }

    #[test]
    fn supports_explicit_variant() {
        let html = dioxus_ssr::render_element(rsx! {
            Button { variant: "secondary".to_string(), "Cancel" }
        });
        assert!(
            html.contains("btn-secondary"),
            "secondary variant class missing: {html}"
        );
    }

    #[test]
    fn supports_disabled_state() {
        let html = dioxus_ssr::render_element(rsx! {
            Button { disabled: true, "Disabled" }
        });
        assert!(
            html.contains("disabled"),
            "disabled attribute missing: {html}"
        );
    }

    #[test]
    fn omits_disabled_when_false() {
        let html = dioxus_ssr::render_element(rsx! {
            Button { "Enabled" }
        });
        assert!(
            !html.contains("disabled"),
            "disabled attribute leaked when false: {html}"
        );
    }
}
