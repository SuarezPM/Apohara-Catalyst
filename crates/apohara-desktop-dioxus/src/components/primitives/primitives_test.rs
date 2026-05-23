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

#[cfg(test)]
mod input_tests {
    use crate::components::primitives::Input;
    use dioxus::prelude::*;

    #[test]
    fn renders_input_with_brand_class_and_default_text_type() {
        let html = dioxus_ssr::render_element(rsx! {
            Input { value: "".to_string() }
        });
        assert!(html.contains("class=\"input"), "input class missing: {html}");
        assert!(
            html.contains("type=\"text\""),
            "default text type missing: {html}"
        );
    }

    #[test]
    fn forwards_value_and_placeholder() {
        let html = dioxus_ssr::render_element(rsx! {
            Input {
                value: "hola".to_string(),
                placeholder: "type here".to_string(),
            }
        });
        assert!(html.contains("value=\"hola\""), "value missing: {html}");
        assert!(
            html.contains("placeholder=\"type here\""),
            "placeholder missing: {html}"
        );
    }

    #[test]
    fn supports_explicit_type_override() {
        let html = dioxus_ssr::render_element(rsx! {
            Input {
                value: "".to_string(),
                input_type: "password".to_string(),
            }
        });
        assert!(
            html.contains("type=\"password\""),
            "custom type missing: {html}"
        );
    }
}

#[cfg(test)]
mod card_tests {
    use crate::components::primitives::Card;
    use dioxus::prelude::*;

    #[test]
    fn wraps_children_in_brand_card() {
        let html = dioxus_ssr::render_element(rsx! {
            Card { "hello" }
        });
        assert!(html.contains("class=\"card"), "card class missing: {html}");
        assert!(html.contains("hello"), "children missing: {html}");
    }

    #[test]
    fn merges_extra_class_when_provided() {
        let html = dioxus_ssr::render_element(rsx! {
            Card { extra_class: "task".to_string(), "x" }
        });
        assert!(
            html.contains("card task"),
            "extra class not merged: {html}"
        );
    }
}
