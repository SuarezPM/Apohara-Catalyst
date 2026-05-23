//! Tests for `plan_status_cache` — fast path, sha re-validation, LKG.

use crate::plan_status_cache::PlanStatusCache;
use std::fs;
use std::thread;
use std::time::Duration;
use tempfile::TempDir;

const PLAN_OK: &str = "---\ntitle: Cached Plan\nstatus: active\n---\n## Objective\nShip it.\n";
const PLAN_BROKEN: &str = "---\ntitle: Broken\nstatus: bogus\n---\n## Objective\nx\n";
const PLAN_V2: &str = "---\ntitle: Cached Plan\nstatus: paused\n---\n## Objective\nShip later.\n";

fn write(path: &std::path::Path, body: &str) {
    fs::write(path, body).unwrap();
}

#[test]
fn first_read_parses_and_populates_cache() {
    let tmp = TempDir::new().unwrap();
    let p = tmp.path().join("a.md");
    write(&p, PLAN_OK);

    let cache = PlanStatusCache::new();
    assert_eq!(cache.parse_count(), 0);
    let plan = cache.get_fast(&p).unwrap();
    assert_eq!(plan.title, "Cached Plan");
    assert_eq!(cache.parse_count(), 1);
    assert_eq!(cache.len(), 1);
}

#[test]
fn second_read_with_unchanged_mtime_does_not_reparse() {
    let tmp = TempDir::new().unwrap();
    let p = tmp.path().join("a.md");
    write(&p, PLAN_OK);

    let cache = PlanStatusCache::new();
    cache.get_fast(&p).unwrap();
    cache.get_fast(&p).unwrap();
    cache.get_fast(&p).unwrap();
    assert_eq!(cache.parse_count(), 1, "fast path should skip reparse");
}

#[test]
fn touch_with_same_content_does_not_reparse() {
    let tmp = TempDir::new().unwrap();
    let p = tmp.path().join("a.md");
    write(&p, PLAN_OK);

    let cache = PlanStatusCache::new();
    cache.get_fast(&p).unwrap();

    // Ensure mtime can change observably on filesystems with 1s granularity.
    thread::sleep(Duration::from_millis(1100));
    write(&p, PLAN_OK); // identical bytes → same sha
    cache.get_fast(&p).unwrap();
    assert_eq!(cache.parse_count(), 1, "sha unchanged → no reparse");
}

#[test]
fn content_change_triggers_reparse() {
    let tmp = TempDir::new().unwrap();
    let p = tmp.path().join("a.md");
    write(&p, PLAN_OK);

    let cache = PlanStatusCache::new();
    let v1 = cache.get_fast(&p).unwrap();
    assert!(matches!(v1.status, crate::PlanStatus::Active));

    thread::sleep(Duration::from_millis(1100));
    write(&p, PLAN_V2);
    let v2 = cache.get_fast(&p).unwrap();
    assert!(matches!(v2.status, crate::PlanStatus::Paused));
    assert_eq!(cache.parse_count(), 2);
}

#[test]
fn clear_invalidates_a_single_entry() {
    let tmp = TempDir::new().unwrap();
    let p = tmp.path().join("a.md");
    write(&p, PLAN_OK);

    let cache = PlanStatusCache::new();
    cache.get_fast(&p).unwrap();
    assert_eq!(cache.len(), 1);
    cache.clear(&p);
    assert_eq!(cache.len(), 0);
    // LKG persists across cache clear.
    assert!(cache.get_last_known_good(&p).is_some());
    // Next get_fast reparses fresh.
    cache.get_fast(&p).unwrap();
    assert_eq!(cache.parse_count(), 2);
}

#[test]
fn get_fast_or_lkg_falls_back_when_parse_fails() {
    let tmp = TempDir::new().unwrap();
    let p = tmp.path().join("a.md");
    write(&p, PLAN_OK);

    let cache = PlanStatusCache::new();
    let v1 = cache.get_fast(&p).unwrap();
    assert_eq!(v1.title, "Cached Plan");

    // Break the file (mid-edit YAML). Simulate a writer.
    thread::sleep(Duration::from_millis(1100));
    write(&p, PLAN_BROKEN);

    // Plain get_fast errors; get_fast_or_lkg returns the LKG.
    assert!(cache.get_fast(&p).is_err());
    let lkg = cache.get_fast_or_lkg(&p).expect("LKG should rescue");
    assert_eq!(lkg.title, "Cached Plan");
}

#[test]
fn get_fast_or_lkg_propagates_error_when_no_lkg() {
    let tmp = TempDir::new().unwrap();
    let p = tmp.path().join("never_seen.md");
    write(&p, PLAN_BROKEN);

    let cache = PlanStatusCache::new();
    assert!(cache.get_fast_or_lkg(&p).is_err());
}

#[test]
fn missing_file_returns_io_error() {
    let tmp = TempDir::new().unwrap();
    let p = tmp.path().join("missing.md");
    let cache = PlanStatusCache::new();
    let err = cache.get_fast(&p).unwrap_err();
    assert!(matches!(err, crate::plan_status_cache::CacheError::Io(_)));
}
