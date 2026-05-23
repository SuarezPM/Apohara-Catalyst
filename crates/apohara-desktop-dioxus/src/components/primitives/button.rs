//! Button — port of `packages/desktop/src/components/ui/Button.tsx`.
//!
//! Variants preserved from React:
//!   - `primary`     → lime background, ink text (default)
//!   - `secondary`   → transparent background, lime border
//!   - `destructive` → red background, bone text
//!   - `ghost`       → transparent, bone text, transparent border
//!
//! Styling lives in `assets/brand.css` under `.btn` + `.btn-<variant>`,
//! so the SSR HTML is class-driven rather than inline-styled (a small
//! divergence from the React original which inlined style objects; we
//! prefer classes so Dioxus can hot-reload the CSS independently).

use dioxus::prelude::*;

#[component]
pub fn Button(
    /// Inline children (label, icon, etc.).
    children: Element,
    /// Visual variant. Defaults to `primary`.
    variant: Option<String>,
    /// Disabled state. When `true`, the rendered `<button>` carries the
    /// `disabled` attribute and CSS dims it via `.btn:disabled`.
    #[props(default = false)]
    disabled: bool,
    /// Optional click handler. Wrapped so the consumer can stay agnostic
    /// of Dioxus' `EventHandler` plumbing in tests.
    onclick: Option<EventHandler<MouseEvent>>,
) -> Element {
    let variant = variant.unwrap_or_else(|| "primary".to_string());
    let class = format!("btn btn-{variant}");

    rsx! {
        button {
            class: "{class}",
            r#type: "button",
            disabled: disabled,
            onclick: move |evt| {
                if let Some(handler) = &onclick {
                    handler.call(evt);
                }
            },
            {children}
        }
    }
}
