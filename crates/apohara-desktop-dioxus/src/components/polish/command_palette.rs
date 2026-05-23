//! CommandPalette — cmd+K palette ported from
//! `packages/desktop/src/components/CommandPalette.tsx`.
//!
//! The React original delegated filtering to the `cmdk` library
//! (`Command` + `Command.Input` + `Command.Item`). Here we drive the
//! filter ourselves with `fuzzy-matcher`'s SkimMatcherV2 — the same
//! algorithm `cmdk` uses under the hood — so the rendered list is a
//! direct, render-time projection of `(commands, query)`. This keeps
//! the component SSR-friendly: no hooks, no internal state.
//!
//! Global cmd+K wiring (open/close, focus trap, Escape handler) is
//! deliberately deferred to Sprint 19 G2.D when the global keyboard
//! hook lands. For now `visible` is owned by the parent.
//!
//! Each command is a `(id, label)` tuple. `on_select` receives the id
//! of the clicked entry — handler is optional so render-only tests can
//! omit it.

use dioxus::prelude::*;
use fuzzy_matcher::skim::SkimMatcherV2;
use fuzzy_matcher::FuzzyMatcher;

#[component]
pub fn CommandPalette(
    /// `(id, label)` pairs the user can pick from. Filtering matches
    /// against the label only; the id flows through to `on_select`.
    commands: Vec<(String, String)>,
    /// Current fuzzy-search query. Empty query renders all commands.
    query: String,
    /// Whether the palette is shown. Empty fragment when false so the
    /// dialog backdrop does not eat clicks.
    visible: bool,
    /// Fired with the command id when the user clicks an entry.
    on_select: Option<EventHandler<String>>,
) -> Element {
    if !visible {
        return rsx! {};
    }

    // SkimMatcherV2 mirrors the algorithm `cmdk` ships, so the result
    // ordering will match the React original closely enough for muscle
    // memory. Score is unused for now (we keep input order); a later
    // pass could sort by score if users start asking for it.
    let matcher = SkimMatcherV2::default();
    let filtered: Vec<&(String, String)> = commands
        .iter()
        .filter(|(_, label)| {
            query.is_empty() || matcher.fuzzy_match(label, &query).is_some()
        })
        .collect();

    rsx! {
        div {
            class: "dialog-backdrop",
            "data-testid": "command-palette-backdrop",
            div {
                class: "card command-palette",
                "data-testid": "command-palette",
                role: "dialog",
                "aria-modal": "true",
                "aria-label": "Command palette",
                input {
                    class: "input cmd-input",
                    placeholder: "Type a command…",
                    value: "{query}",
                    autofocus: true,
                    "aria-label": "Command query",
                }
                ul {
                    class: "cmd-results",
                    role: "listbox",
                    if filtered.is_empty() {
                        li {
                            class: "cmd-empty",
                            "data-testid": "command-palette-empty",
                            "No matches."
                        }
                    } else {
                        for (id, label) in filtered {
                            li {
                                class: "cmd-item",
                                key: "{id}",
                                role: "option",
                                "data-command-id": "{id}",
                                onclick: {
                                    let id = id.clone();
                                    move |_| {
                                        if let Some(handler) = &on_select {
                                            handler.call(id.clone());
                                        }
                                    }
                                },
                                "{label}"
                            }
                        }
                    }
                }
            }
        }
    }
}
