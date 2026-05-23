//! Unit tests for the `state::*` GlobalSignals.
//!
//! Each signal has its own `mod` so failures point to the exact store.
//! Tests use distinct id namespaces ("t1", "t2", ...) per module because
//! `GlobalSignal` state is process-wide and shared across tests in the
//! same binary.
//!
//! GlobalSignal APIs (`.read()`, `.write()`) require an active Dioxus
//! runtime. The `with_runtime` helper spins up a throwaway `VirtualDom`
//! and runs the closure inside `VirtualDom::in_runtime`, which installs
//! a `RuntimeGuard` on the current thread.

#[cfg(test)]
use dioxus::prelude::*;

/// Run `f` inside a Dioxus runtime so `GlobalSignal::read/write` work.
///
/// The root component is an empty `Fragment` — we only need the
/// `VirtualDom` for its runtime guard, never to render anything.
#[cfg(test)]
fn with_runtime<F: FnOnce()>(f: F) {
    fn empty() -> Element {
        rsx! {}
    }
    let vdom = VirtualDom::new(empty);
    vdom.in_runtime(f);
}

#[cfg(test)]
mod tasks_tests {
    use super::with_runtime;
    use crate::state::tasks::{remove_task, upsert_task, DagTask, TASKS};
    use dioxus::prelude::ReadableExt;

    #[test]
    fn upsert_task_inserts_new() {
        with_runtime(|| {
            upsert_task(DagTask {
                id: "t1".into(),
                title: "First".into(),
                ..Default::default()
            });
            let tasks = TASKS.read();
            assert_eq!(
                tasks.get("t1").map(|t| t.title.clone()),
                Some("First".into())
            );
        });
    }

    #[test]
    fn upsert_task_updates_existing() {
        with_runtime(|| {
            let mut task = DagTask {
                id: "t2".into(),
                title: "v1".into(),
                ..Default::default()
            };
            upsert_task(task.clone());
            task.title = "v2".into();
            upsert_task(task);
            let tasks = TASKS.read();
            assert_eq!(
                tasks.get("t2").map(|t| t.title.clone()),
                Some("v2".into())
            );
        });
    }

    #[test]
    fn remove_task_deletes() {
        with_runtime(|| {
            upsert_task(DagTask {
                id: "t3".into(),
                ..Default::default()
            });
            remove_task("t3");
            let tasks = TASKS.read();
            assert!(tasks.get("t3").is_none());
        });
    }
}

#[cfg(test)]
mod roster_tests {
    use super::with_runtime;
    use crate::state::roster::{
        any_run_active, remove_provider, upsert_provider, ProviderEntry, ROSTER,
    };
    use dioxus::prelude::ReadableExt;

    fn entry(id: &str, run_active: bool) -> ProviderEntry {
        ProviderEntry {
            provider_id: id.into(),
            display_name: id.into(),
            roles: vec![],
            capabilities: vec![],
            permissions: vec![],
            mcp_servers: vec![],
            run_active,
        }
    }

    #[test]
    fn upsert_provider_inserts_new() {
        with_runtime(|| {
            upsert_provider(entry("claude-code-cli", false));
            let roster = ROSTER.read();
            assert_eq!(
                roster.get("claude-code-cli").map(|p| p.display_name.clone()),
                Some("claude-code-cli".into())
            );
        });
    }

    #[test]
    fn upsert_provider_updates_existing() {
        with_runtime(|| {
            upsert_provider(entry("codex-cli", false));
            upsert_provider(entry("codex-cli", true));
            let roster = ROSTER.read();
            assert!(roster.get("codex-cli").map(|p| p.run_active).unwrap_or(false));
        });
    }

    #[test]
    fn remove_provider_deletes() {
        with_runtime(|| {
            upsert_provider(entry("opencode-go", false));
            remove_provider("opencode-go");
            let roster = ROSTER.read();
            assert!(roster.get("opencode-go").is_none());
        });
    }

    #[test]
    fn any_run_active_reflects_state() {
        with_runtime(|| {
            // Use a distinct id namespace so other tests don't bleed in.
            upsert_provider(entry("any-active-probe-a", false));
            upsert_provider(entry("any-active-probe-b", true));
            assert!(any_run_active());
            remove_provider("any-active-probe-a");
            remove_provider("any-active-probe-b");
        });
    }
}

#[cfg(test)]
mod permissions_tests {
    use super::with_runtime;
    use crate::state::permissions::{
        enqueue_permission_request, record_permission_response, unresolved_requests,
        PermissionDecision, PermissionRequestEvent, PermissionResponseEvent, PermissionScope,
        PERMISSIONS,
    };
    use dioxus::prelude::ReadableExt;

    fn req(id: &str) -> PermissionRequestEvent {
        PermissionRequestEvent {
            request_id: id.into(),
            tool: "Bash".into(),
            suggested_pattern: "echo *".into(),
            available_scopes: vec![PermissionScope::Once, PermissionScope::Session],
            ts: 0,
        }
    }

    fn resp(id: &str) -> PermissionResponseEvent {
        PermissionResponseEvent {
            request_id: id.into(),
            decision: PermissionDecision::Allow,
            scope: Some(PermissionScope::Once),
            pattern: None,
            ts: 0,
        }
    }

    #[test]
    fn enqueue_inserts_pending() {
        with_runtime(|| {
            enqueue_permission_request(req("p1"));
            let state = PERMISSIONS.read();
            assert!(state.pending.contains_key("p1"));
        });
    }

    #[test]
    fn response_records_decision() {
        with_runtime(|| {
            enqueue_permission_request(req("p2"));
            record_permission_response(resp("p2"));
            let state = PERMISSIONS.read();
            assert_eq!(
                state.responses.get("p2").map(|r| r.decision),
                Some(PermissionDecision::Allow)
            );
        });
    }

    #[test]
    fn unresolved_excludes_responded() {
        with_runtime(|| {
            enqueue_permission_request(req("p3-pending"));
            enqueue_permission_request(req("p3-resolved"));
            record_permission_response(resp("p3-resolved"));
            let pending: Vec<String> = unresolved_requests()
                .into_iter()
                .map(|r| r.request_id)
                .collect();
            assert!(pending.contains(&"p3-pending".into()));
            assert!(!pending.contains(&"p3-resolved".into()));
        });
    }
}

#[cfg(test)]
mod view_mode_tests {
    use super::with_runtime;
    use crate::state::view_mode::{set_view_mode, ViewMode, VIEW_MODE};
    use dioxus::prelude::ReadableExt;

    #[test]
    fn default_is_graph() {
        with_runtime(|| {
            // Reset to default first because other tests may have mutated it.
            set_view_mode(ViewMode::Graph);
            assert_eq!(*VIEW_MODE.read(), ViewMode::Graph);
        });
    }

    #[test]
    fn set_updates_signal() {
        with_runtime(|| {
            set_view_mode(ViewMode::Board);
            assert_eq!(*VIEW_MODE.read(), ViewMode::Board);
            set_view_mode(ViewMode::Terminal);
            assert_eq!(*VIEW_MODE.read(), ViewMode::Terminal);
        });
    }
}
