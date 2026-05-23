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
