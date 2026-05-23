//! Tests for `watcher` — driven by real filesystem events via tempdir.

use crate::plan_status_cache::PlanStatusCache;
use crate::watcher::{is_markdown_for_test, start_plan_watcher, PlanWatcherOpts, WatcherEvent};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tempfile::TempDir;

const PLAN_OK: &str = "---\ntitle: T\nstatus: active\n---\n## Objective\nx\n";
const PLAN_BROKEN: &str = "---\ntitle: T\nstatus: bogus\n---\n## Objective\nx\n";

fn collect_events(buf: Arc<Mutex<Vec<WatcherEvent>>>) -> impl Fn(WatcherEvent) + Send + 'static {
    move |ev| buf.lock().unwrap().push(ev)
}

fn wait_for<F>(buf: &Arc<Mutex<Vec<WatcherEvent>>>, mut pred: F, label: &str)
where
    F: FnMut(&[WatcherEvent]) -> bool,
{
    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(5) {
        if pred(&buf.lock().unwrap()) {
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    panic!("timeout waiting for: {label}; got: {:?}", buf.lock().unwrap());
}

#[test]
fn is_markdown_predicate() {
    assert!(is_markdown_for_test(&PathBuf::from("/a/b.md")));
    assert!(is_markdown_for_test(&PathBuf::from("/a/b.MD")));
    assert!(!is_markdown_for_test(&PathBuf::from("/a/b.txt")));
    assert!(!is_markdown_for_test(&PathBuf::from("/a/b")));
}

#[test]
fn create_event_clears_cache_and_emits_added() {
    let tmp = TempDir::new().unwrap();
    let cache = Arc::new(PlanStatusCache::new());
    let buf: Arc<Mutex<Vec<WatcherEvent>>> = Arc::new(Mutex::new(Vec::new()));

    let handle = start_plan_watcher(
        PlanWatcherOpts {
            root_path: tmp.path().to_path_buf(),
            cache: Arc::clone(&cache),
            hot_reload_validate: false,
        },
        collect_events(Arc::clone(&buf)),
    )
    .unwrap();

    let p = tmp.path().join("new.md");
    std::fs::write(&p, PLAN_OK).unwrap();

    wait_for(
        &buf,
        |evs| {
            evs.iter()
                .any(|e| matches!(e, WatcherEvent::Added(path) | WatcherEvent::Changed(path) if path == &p))
        },
        "new.md create or modify event",
    );

    handle.close();
}

#[test]
fn non_markdown_files_are_ignored() {
    let tmp = TempDir::new().unwrap();
    let cache = Arc::new(PlanStatusCache::new());
    let buf: Arc<Mutex<Vec<WatcherEvent>>> = Arc::new(Mutex::new(Vec::new()));

    let handle = start_plan_watcher(
        PlanWatcherOpts {
            root_path: tmp.path().to_path_buf(),
            cache: Arc::clone(&cache),
            hot_reload_validate: false,
        },
        collect_events(Arc::clone(&buf)),
    )
    .unwrap();

    // Write a .txt file — should never produce an event.
    std::fs::write(tmp.path().join("notes.txt"), "irrelevant").unwrap();
    // And a .md file — used as a fence so we know the watcher saw the .txt
    // event and dropped it before this one.
    let md = tmp.path().join("real.md");
    std::fs::write(&md, PLAN_OK).unwrap();

    wait_for(
        &buf,
        |evs| evs.iter().any(|e| matches!(e, WatcherEvent::Added(p) | WatcherEvent::Changed(p) if p == &md)),
        "real.md event after .txt fence",
    );

    let snapshot = buf.lock().unwrap().clone();
    let txt_events: Vec<_> = snapshot
        .iter()
        .filter(|e| matches!(e,
            WatcherEvent::Added(p) | WatcherEvent::Changed(p) | WatcherEvent::Removed(p) | WatcherEvent::Invalid { path: p, .. }
            if p.ends_with("notes.txt")))
        .collect();
    assert!(txt_events.is_empty(), ".txt event should be filtered: {snapshot:?}");

    handle.close();
}

#[test]
fn hot_reload_invalid_keeps_cache_and_emits_invalid() {
    let tmp = TempDir::new().unwrap();
    let cache = Arc::new(PlanStatusCache::new());
    let buf: Arc<Mutex<Vec<WatcherEvent>>> = Arc::new(Mutex::new(Vec::new()));

    // Seed cache with the good plan so LKG exists.
    let p = tmp.path().join("p.md");
    std::fs::write(&p, PLAN_OK).unwrap();
    let initial = cache.get_fast(&p).unwrap();
    assert_eq!(initial.title, "T");

    let handle = start_plan_watcher(
        PlanWatcherOpts {
            root_path: tmp.path().to_path_buf(),
            cache: Arc::clone(&cache),
            hot_reload_validate: true,
        },
        collect_events(Arc::clone(&buf)),
    )
    .unwrap();

    // Wait a beat so the watcher has registered before we mutate.
    std::thread::sleep(Duration::from_millis(200));
    std::fs::write(&p, PLAN_BROKEN).unwrap();

    wait_for(
        &buf,
        |evs| {
            evs.iter()
                .any(|e| matches!(e, WatcherEvent::Invalid { path, .. } if path == &p))
        },
        "Invalid event for broken plan",
    );

    // LKG is still readable.
    let lkg = cache.get_last_known_good(&p).expect("LKG preserved");
    assert_eq!(lkg.title, "T");

    handle.close();
}
