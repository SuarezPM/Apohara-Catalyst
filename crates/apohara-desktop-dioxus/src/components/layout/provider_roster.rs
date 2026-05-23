//! ProviderRoster — Apohara Catalyst active-provider status panel (MVP,
//! G2.B.3).
//!
//! React reference is `packages/desktop/src/components/RosterPicker.tsx`;
//! the standalone "ProviderRoster.tsx" name in the plan reflects the
//! Phase 2 layout split where the roster card grid moves out of the
//! popover into its own surface. The MVP here only renders the
//! always-on active trio (claude-code-cli / codex-cli / opencode-go) per
//! CLAUDE.md's hard rule — LEGACY providers are hidden behind
//! `APOHARA_LEGACY_PROVIDERS=1` and don't show up in the v1 surface.
//!
//! Per Sprint 17 Wave A scope, the component accepts a `Vec<ProviderStatus>`
//! prop. Sprint 18 (G2.C) wires it to the GlobalSignal roster store and
//! adds trust-preset editing.

use dioxus::prelude::*;

/// Roster-card health badge. Mirrors the upstream `health` field on
/// `BaseAgentProvider::status()` (see `src/core/providers/`) — the v1
/// runtime emits `healthy` / `degraded` / `unknown`. We deliberately do
/// not model `down` here because the React surface coalesces it into
/// `degraded` for display.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProviderHealth {
    Healthy,
    Degraded,
    Unknown,
}

impl ProviderHealth {
    fn as_data_attr(self) -> &'static str {
        match self {
            ProviderHealth::Healthy => "healthy",
            ProviderHealth::Degraded => "degraded",
            ProviderHealth::Unknown => "unknown",
        }
    }

    fn glyph(self) -> &'static str {
        match self {
            ProviderHealth::Healthy => "OK",
            ProviderHealth::Degraded => "WARN",
            ProviderHealth::Unknown => "??",
        }
    }
}

/// Single row in the roster. `id` is the provider id used by the router
/// (e.g. `claude-code-cli`); `label` is the user-facing string.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProviderStatus {
    pub id: String,
    pub label: String,
    pub health: ProviderHealth,
}

#[component]
pub fn ProviderRoster(providers: Vec<ProviderStatus>) -> Element {
    let is_empty = providers.is_empty();
    rsx! {
        section {
            class: "provider-roster",
            "data-testid": "provider-roster",
            "aria-label": "Active providers",
            header {
                class: "provider-roster-header",
                h3 {
                    class: "press-start-2p provider-roster-title",
                    "Active providers"
                }
            }
            if is_empty {
                div {
                    class: "provider-roster-empty",
                    "data-testid": "provider-roster-empty",
                    "No providers enabled."
                }
            } else {
                ul {
                    class: "provider-roster-list",
                    for provider in providers {
                        ProviderRosterRow { provider }
                    }
                }
            }
        }
    }
}

#[component]
fn ProviderRosterRow(provider: ProviderStatus) -> Element {
    let testid = format!("provider-roster-card-{}", provider.id);
    let health_attr = provider.health.as_data_attr();
    let glyph = provider.health.glyph();
    rsx! {
        li {
            class: "card provider-roster-card",
            "data-testid": "{testid}",
            "data-provider-id": "{provider.id}",
            div {
                class: "provider-roster-card-body",
                span {
                    class: "provider-roster-card-label",
                    "{provider.label}"
                }
                small {
                    class: "provider-roster-card-id",
                    "{provider.id}"
                }
            }
            span {
                class: "provider-roster-card-health",
                "data-health": "{health_attr}",
                "aria-label": "health {health_attr}",
                "{glyph}"
            }
        }
    }
}
