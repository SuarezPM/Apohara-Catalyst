//! Left pane slot (grid-area: left). Hosts the ProviderRoster — availability is
//! probed from `PATH` at startup — and the ObjectivePane below it, whose
//! controlled textarea is bound to `OBJECTIVE_INPUT` (W3.A.4).

use dioxus::prelude::*;

use apohara_decomposer::{decompose_spec, AgentRole};
use apohara_dispatch::api::list_active_providers;

use crate::components::layout::{ProviderHealth, ProviderRoster, ProviderStatus};
use crate::components::{ObjectiveMode, ObjectivePane};
use crate::state::objective_input::{self, OBJECTIVE_INPUT};
use crate::state::roster::{upsert_provider, ProviderEntry, ROSTER};
use crate::state::running_status::{self, status, RunStatus};
use crate::state::tasks::{upsert_task, DagTask, TaskStatus};

/// Write the objective text into `OBJECTIVE_INPUT`. This is what the controlled
/// textarea fires on every keystroke (ObjectivePane `on_input`); kept a free fn
/// so the binding is unit-testable without a DOM event.
pub(crate) fn set_objective(text: String) {
    objective_input::set(text);
}

/// Run the current objective: flip `RUNNING_STATUS` to `Dispatching` for
/// immediate feedback, then hand the objective to the `dispatch_loop` coroutine
/// (no-op until it is mounted on the desktop runtime).
pub(crate) fn run_objective(text: String) {
    running_status::set_status(RunStatus::Dispatching);
    if let Some(tx) = crate::coroutines::dispatch_loop::DISPATCH_TX.read().as_ref() {
        tx.send(crate::coroutines::dispatch_loop::DispatchMsg::Run(text));
    }
}

/// Load the objective text as an inline SPEC: decompose it into tasks and
/// populate `TASKS`. The async/file-path `parse_plan_document` path is deferred
/// to W4 (W3.A.4 design decision: textarea-as-inline-SPEC, no file dialog).
pub(crate) fn load_spec(text: String) {
    for raw in decompose_spec(&text).tasks {
        upsert_task(DagTask {
            id: raw.id,
            title: raw.description,
            status: TaskStatus::Pending,
            agent_role: Some(agent_role_label(raw.agent_role).to_string()),
            ..DagTask::default()
        });
    }
}

/// Lowercase label for a decomposer `AgentRole` (matches its serde rename).
fn agent_role_label(role: AgentRole) -> &'static str {
    match role {
        AgentRole::Planner => "planner",
        AgentRole::Coder => "coder",
        AgentRole::Critic => "critic",
        AgentRole::Judge => "judge",
        AgentRole::Explorer => "explorer",
        AgentRole::Editor => "editor",
    }
}

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

    let roster_csv = available
        .iter()
        .map(|p| p.id.clone())
        .collect::<Vec<_>>()
        .join(",");
    let objective = OBJECTIVE_INPUT.read().clone();
    let running = status() != RunStatus::Idle;

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
            ObjectivePane {
                active: running,
                mode: ObjectiveMode::Cloud,
                roster_csv,
                value: Some(objective),
                on_input: set_objective,
                on_run: run_objective,
                on_load_spec: load_spec,
            }
        }
    }
}
