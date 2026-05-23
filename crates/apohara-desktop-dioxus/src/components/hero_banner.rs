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
//! Brand: G9.A.3 rebrand — wordmark uses `.font-display` (Press Start 2P)
//! in the lime token. The pixel-art mascot slot from the React component
//! is intentionally deferred to G2.B (Wave A) when PixelCanvas itself is
//! ported; until then we render a placeholder `[chief]` glyph so the
//! layout stays representative.

use dioxus::prelude::*;

#[component]
pub fn HeroBanner(
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
            style: "margin: 1.5rem auto; padding: 1.5rem 2rem; max-width: 720px; background: var(--apohara-ink); border: 2px solid var(--apohara-lime); border-radius: 4px; color: var(--apohara-bone); text-align: center;",
            div {
                style: "display: flex; align-items: center; justify-content: center; gap: 16px; margin-bottom: 0.75rem;",
                div {
                    "data-testid": "hero-banner-mascot",
                    style: "flex-shrink: 0; width: 48px; height: 48px; display: inline-flex; align-items: center; justify-content: center; color: var(--apohara-lime); font-family: 'Press Start 2P', monospace; font-size: 10px;",
                    // Mascot slot — real PixelCanvas lands G2.B.
                    "[chief]"
                }
                h2 {
                    class: "font-display",
                    "data-testid": "hero-banner-wordmark",
                    style: "margin: 0; font-size: 1.1rem; color: var(--apohara-lime); letter-spacing: 3px; line-height: 1.4;",
                    "APOHARA CATALYST"
                }
            }
            p {
                "data-testid": "hero-banner-tagline",
                style: "margin: 0 0 1rem 0; color: rgba(237, 239, 240, 0.7); font-family: var(--font-mono); font-size: 0.85rem;",
                "{tagline}"
            }
            div {
                style: "display: flex; gap: 0.75rem; justify-content: center; flex-wrap: wrap;",
                if let Some(handler) = on_seed_demo {
                    button {
                        r#type: "button",
                        "data-testid": "hero-banner-seed-cta",
                        onclick: move |evt| handler.call(evt),
                        style: "padding: 0.5rem 1rem; background: var(--apohara-lime); color: var(--apohara-ink); border: 2px solid var(--apohara-lime); border-radius: 4px; cursor: pointer; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; letter-spacing: 1px; text-transform: uppercase;",
                        "Try the demo"
                    }
                }
                a {
                    "data-testid": "hero-banner-docs-link",
                    href: "https://github.com/SuarezPM/apohara#readme",
                    target: "_blank",
                    rel: "noreferrer noopener",
                    style: "padding: 0.5rem 1rem; background: transparent; color: var(--apohara-bone); border: 2px solid var(--apohara-bone); border-radius: 4px; text-decoration: none; font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700; letter-spacing: 1px; text-transform: uppercase;",
                    "Read the docs"
                }
            }
        }
    }
}
