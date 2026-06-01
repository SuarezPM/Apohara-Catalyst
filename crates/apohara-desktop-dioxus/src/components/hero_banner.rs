//! HeroBanner — Apohara Catalyst empty-state intro card.
//!
//! Direct port of `packages/desktop/src/components/HeroBanner.tsx`. The
//! React original reads `tasksAtom` directly via jotai; we keep that data
//! plumbing OUT of this component so it stays testable headlessly. The
//! container (App / TaskBoard scaffolding) is responsible for asking the
//! orchestration DB and passing `tasks_empty` down as a prop.
//!
//! Visibility rules (preserved from React):
//!   - `session_id == Some(_)` → hide entirely.
//!   - `tasks_empty == false`  → hide entirely.
//!   - else                    → render the wordmark + tagline + CTAs.
//!
//! Brand: design-system v2 — the wordmark uses `.font-display`
//! (Space Grotesk, uppercase + tracked) in the lime token; Press Start 2P is
//! gone. The pixel-art mascot slot from the React component is intentionally
//! deferred to G2.B (Wave A) when PixelCanvas itself is ported; until then we
//! render a placeholder `[chief]` glyph so the layout stays representative.

use dioxus::prelude::*;

#[component]
pub fn HeroBanner(
    /// When `true`, render a slim always-visible header strip instead of the
    /// full empty-state card. Driven by `RUNNING_STATUS != Idle` (W3.A.1).
    #[props(default)]
    compact: bool,
    /// Active session id; if `Some` the banner hides.
    session_id: Option<String>,
    /// Whether the orchestration store is currently task-empty.
    tasks_empty: bool,
    /// Tagline shown beneath the wordmark.
    tagline: String,
    /// Optional callback fired by the "Try the demo" CTA. When `None`, the
    /// button is omitted so the layout collapses to docs-only.
    on_seed_demo: Option<EventHandler<MouseEvent>>,
) -> Element {
    if compact {
        return rsx! {
            section {
                class: "hero-banner hero-banner--compact",
                "data-testid": "hero-banner-compact",
                role: "region",
                "aria-label": "Apohara Catalyst — run in progress",
                style: "display: flex; align-items: center; gap: 12px; padding: 0.4rem 1rem; background: var(--apo-bg-space); border-bottom: 1px solid var(--apo-border); color: var(--apo-text);",
                span {
                    class: "font-display",
                    style: "color: var(--apo-text); font-family: var(--apo-font-display); text-transform: uppercase; font-size: 0.8rem; letter-spacing: 0.2em; text-shadow: var(--apo-text-glow-lime);",
                    "APOHARA CATALYST"
                }
            }
        };
    }
    if session_id.is_some() {
        return rsx! {};
    }
    if !tasks_empty {
        return rsx! {};
    }

    rsx! {
        section {
            class: "hero-banner",
            "data-testid": "hero-banner",
            role: "region",
            "aria-label": "Apohara Catalyst welcome",
            style: "margin: 1.5rem auto; padding: 1.5rem 2rem; max-width: 720px; background-color: var(--apo-bg-panel); background-image: var(--apo-grad-topo); border: 1px solid var(--apo-border); border-radius: var(--apo-radius-lg); color: var(--apo-text); text-align: center;",
            div {
                style: "display: flex; align-items: center; justify-content: center; gap: 16px; margin-bottom: 0.75rem;",
                div {
                    "data-testid": "hero-banner-mascot",
                    style: "flex-shrink: 0; width: 48px; height: 48px; display: inline-flex; align-items: center; justify-content: center; color: var(--apo-lime); font-family: var(--apo-font-mono); font-size: 10px;",
                    // Mascot slot — real PixelCanvas lands G2.B.
                    "[chief]"
                }
                h2 {
                    class: "font-display",
                    "data-testid": "hero-banner-wordmark",
                    // Crema wordmark, display family, heavy tracking, subtle lime
                    // glow (design system §4 — crema, NOT pure white/lime).
                    style: "margin: 0; font-family: var(--apo-font-display); text-transform: uppercase; font-size: 1.6rem; color: var(--apo-text); letter-spacing: 0.2em; line-height: 1.3; text-shadow: var(--apo-text-glow-lime);",
                    "APOHARA CATALYST"
                }
            }
            p {
                "data-testid": "hero-banner-tagline",
                style: "margin: 0 0 1rem 0; color: var(--apo-text-dim); font-family: var(--apo-font-mono); font-size: 0.85rem;",
                "{tagline}"
            }
            div {
                style: "display: flex; gap: 0.75rem; justify-content: center; flex-wrap: wrap;",
                if let Some(handler) = on_seed_demo {
                    button {
                        r#type: "button",
                        "data-testid": "hero-banner-seed-cta",
                        onclick: move |evt| handler.call(evt),
                        style: "padding: 0.5rem 1rem; background: var(--apo-lime); color: var(--apo-lime-fg); border: 1px solid var(--apo-lime); border-radius: var(--apo-radius-md); cursor: pointer; font-family: var(--apo-font-mono); font-size: 0.8rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;",
                        "Try the demo"
                    }
                }
                a {
                    "data-testid": "hero-banner-docs-link",
                    href: "https://github.com/SuarezPM/apohara#readme",
                    target: "_blank",
                    rel: "noreferrer noopener",
                    style: "padding: 0.5rem 1rem; background: transparent; color: var(--apo-text-dim); border: 1px solid var(--apo-border-strong); border-radius: var(--apo-radius-md); text-decoration: none; font-family: var(--apo-font-mono); font-size: 0.8rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;",
                    "Read the docs"
                }
            }
        }
    }
}
