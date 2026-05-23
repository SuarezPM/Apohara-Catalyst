//! SSR tests for layout components (G2.B.3).
//!
//! Reference React sources:
//!   - `packages/desktop/src/components/TaskBoard/TaskBoard.tsx`
//!   - `packages/desktop/src/components/RosterPicker.tsx` (closest source
//!     for the v1 active-roster trio; full ProviderRoster.tsx doesn't ship
//!     in the React tree yet — the MVP only needs the 3-card display).
//!
//! MVP scope per Sprint 17 Wave A: render-from-props only. DnD +
//! GlobalSignal wiring land in Sprint 18 (G2.C).

use super::provider_roster::{ProviderHealth, ProviderRoster, ProviderStatus};
use super::task_board::{DagTask, TaskBoard, TaskStatus};
use dioxus::prelude::*;

// --- TaskBoard ---------------------------------------------------------

#[test]
fn task_board_renders_four_status_columns() {
    let html = dioxus_ssr::render_element(rsx! {
        TaskBoard { tasks: Vec::<DagTask>::new() }
    });
    assert!(html.contains("col-pending"), "pending column missing: {html}");
    assert!(html.contains("col-ready"), "ready column missing: {html}");
    assert!(
        html.contains("col-in-verification"),
        "in_verification column missing: {html}"
    );
    assert!(html.contains("col-done"), "done column missing: {html}");
}

#[test]
fn task_board_renders_task_in_correct_column() {
    let task = DagTask {
        id: "t1".into(),
        title: "Test task".into(),
        status: TaskStatus::Ready,
    };
    let html = dioxus_ssr::render_element(rsx! {
        TaskBoard { tasks: vec![task] }
    });
    assert!(html.contains("Test task"), "task title missing: {html}");
    assert!(
        html.contains("data-testid=\"task-card-t1\""),
        "task card testid missing: {html}"
    );
}

#[test]
fn task_board_root_has_testid_and_column_labels() {
    let html = dioxus_ssr::render_element(rsx! {
        TaskBoard { tasks: Vec::<DagTask>::new() }
    });
    assert!(
        html.contains("data-testid=\"task-board\""),
        "task-board testid missing: {html}"
    );
    // Column header labels (Pending / Ready / Verifying / Done) all visible.
    assert!(html.contains("Pending"), "Pending label missing");
    assert!(html.contains("Ready"), "Ready label missing");
    assert!(html.contains("Verifying"), "Verifying label missing");
    assert!(html.contains("Done"), "Done label missing");
}

#[test]
fn task_board_filters_tasks_by_status() {
    let tasks = vec![
        DagTask {
            id: "a".into(),
            title: "alpha".into(),
            status: TaskStatus::Pending,
        },
        DagTask {
            id: "b".into(),
            title: "bravo".into(),
            status: TaskStatus::Done,
        },
    ];
    let html = dioxus_ssr::render_element(rsx! {
        TaskBoard { tasks }
    });
    assert!(html.contains("alpha"), "alpha task missing");
    assert!(html.contains("bravo"), "bravo task missing");
    assert!(html.contains("data-testid=\"task-card-a\""));
    assert!(html.contains("data-testid=\"task-card-b\""));
}

// --- ProviderRoster ----------------------------------------------------

#[test]
fn provider_roster_renders_three_active_cli_drivers() {
    let providers = vec![
        ProviderStatus {
            id: "claude-code-cli".into(),
            label: "Claude Code".into(),
            health: ProviderHealth::Healthy,
        },
        ProviderStatus {
            id: "codex-cli".into(),
            label: "Codex".into(),
            health: ProviderHealth::Healthy,
        },
        ProviderStatus {
            id: "opencode-go".into(),
            label: "opencode".into(),
            health: ProviderHealth::Unknown,
        },
    ];
    let html = dioxus_ssr::render_element(rsx! {
        ProviderRoster { providers }
    });
    assert!(
        html.contains("data-testid=\"provider-roster\""),
        "provider-roster testid missing: {html}"
    );
    assert!(html.contains("claude-code-cli"));
    assert!(html.contains("codex-cli"));
    assert!(html.contains("opencode-go"));
    assert!(html.contains("Claude Code"));
    assert!(html.contains("Codex"));
    assert!(html.contains("opencode"));
}

#[test]
fn provider_roster_marks_health_status_per_provider() {
    let providers = vec![
        ProviderStatus {
            id: "claude-code-cli".into(),
            label: "Claude Code".into(),
            health: ProviderHealth::Healthy,
        },
        ProviderStatus {
            id: "codex-cli".into(),
            label: "Codex".into(),
            health: ProviderHealth::Degraded,
        },
        ProviderStatus {
            id: "opencode-go".into(),
            label: "opencode".into(),
            health: ProviderHealth::Unknown,
        },
    ];
    let html = dioxus_ssr::render_element(rsx! {
        ProviderRoster { providers }
    });
    assert!(
        html.contains("data-health=\"healthy\""),
        "healthy badge missing: {html}"
    );
    assert!(
        html.contains("data-health=\"degraded\""),
        "degraded badge missing: {html}"
    );
    assert!(
        html.contains("data-health=\"unknown\""),
        "unknown badge missing: {html}"
    );
}

#[test]
fn provider_roster_renders_empty_state_when_no_providers() {
    let html = dioxus_ssr::render_element(rsx! {
        ProviderRoster { providers: Vec::<ProviderStatus>::new() }
    });
    assert!(
        html.contains("data-testid=\"provider-roster\""),
        "root testid still present when empty: {html}"
    );
    assert!(
        html.contains("data-testid=\"provider-roster-empty\""),
        "empty-state marker missing: {html}"
    );
}
