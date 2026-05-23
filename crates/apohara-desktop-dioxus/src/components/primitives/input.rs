//! Input — port of `packages/desktop/src/components/ui/Input.tsx`.
//!
//! The React original swapped its border colour on focus / blur via inline
//! event handlers. We move that purely to CSS (`.input:focus`) so the
//! Dioxus event surface stays small — the Sprint 18 controllers wire
//! real `oninput` / `onblur` handlers when they need to react to value
//! changes. The visual contract (lime border on focus) is preserved.
//!
//! Field name `input_type` (instead of `type`) avoids the Rust keyword
//! and matches the rsx! attribute name `r#type` we emit downstream.

use dioxus::prelude::*;

#[component]
pub fn Input(
    /// Current value of the input. Required so the component is always
    /// controlled — uncontrolled inputs do not survive Dioxus re-renders
    /// cleanly without local signals.
    value: String,
    /// HTML `type` attribute. Defaults to `"text"`. Use `"password"`,
    /// `"number"`, etc.
    input_type: Option<String>,
    /// Placeholder string. Empty by default (no attribute emitted).
    #[props(default)]
    placeholder: String,
    /// Optional `name` attribute, useful inside `<form>` containers.
    #[props(default)]
    name: String,
    /// Disabled state.
    #[props(default = false)]
    disabled: bool,
    /// Value-change handler. Receives the new string value.
    oninput: Option<EventHandler<String>>,
) -> Element {
    let input_type = input_type.unwrap_or_else(|| "text".to_string());

    rsx! {
        input {
            class: "input",
            r#type: "{input_type}",
            value: "{value}",
            placeholder: "{placeholder}",
            name: "{name}",
            disabled: disabled,
            oninput: move |evt| {
                if let Some(handler) = &oninput {
                    handler.call(evt.value());
                }
            },
        }
    }
}
