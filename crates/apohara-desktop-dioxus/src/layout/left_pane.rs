//! Left pane slot (grid-area: left). Hosts the ProviderRoster — availability is
//! probed from `PATH` at startup. ObjectivePane (W3.A.4) mounts below it next.

use dioxus::prelude::*;

use apohara_dispatch::api::list_active_providers;

use crate::components::layout::{ProviderHealth, ProviderRoster, ProviderStatus};
use crate::state::roster::{upsert_provider, ProviderEntry, ROSTER};

#[component]
pub fn LeftPane() -> Element {
    // Startup probe: resolve the active CLI binaries on PATH and write them into
    // ROSTER. `use_future` defers past the first (SSR) render, so the pane shows
    // the empty-state until the probe lands.
    use_future(|| async {
        for p in list_active_providers() {
            upsert_provider(ProviderEntry {
                provider_id: p.id.clone(),
                display_name: p.id,
                roles: vec![],
                capabilities: vec![],
                permissions: vec![],
                mcp_servers: vec![],
                run_active: false,
                available: p.available,
            });
        }
    });

    // Show only providers whose CLI binary was found on PATH.
    let available: Vec<ProviderStatus> = ROSTER
        .read()
        .values()
        .filter(|e| e.available)
        .map(|e| ProviderStatus {
            id: e.provider_id.clone(),
            label: e.display_name.clone(),
            health: ProviderHealth::Healthy,
        })
        .collect();

    rsx! {
        div { class: "left", "data-testid": "layout-left",
            if available.is_empty() {
                div {
                    class: "card provider-roster-empty",
                    "data-testid": "provider-roster-empty",
                    p { "No providers found on PATH." }
                    button {
                        r#type: "button",
                        "data-testid": "provider-roster-install",
                        // Opens the CommandPalette install hint once wired (W3.D.1).
                        "How to install"
                    }
                }
            } else {
                ProviderRoster { providers: available }
            }
        }
    }
}
