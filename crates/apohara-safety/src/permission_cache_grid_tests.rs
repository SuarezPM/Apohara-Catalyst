use super::permission_cache::PermissionCache;
use super::permission_grid::{PermissionGrid, PermissionScope, PermissionState};

#[test]
fn cache_add_and_has() {
    let mut c = PermissionCache::new();
    c.add("sess-1", "Bash(npm test:*)");
    assert!(c.has("sess-1", "Bash(npm test:*)"));
    assert!(!c.has("sess-1", "Bash(rm:*)"));
    assert!(!c.has("sess-2", "Bash(npm test:*)"));
}

#[test]
fn cache_list_returns_all_patterns() {
    let mut c = PermissionCache::new();
    c.add("s", "a");
    c.add("s", "b");
    let mut listed = c.list("s");
    listed.sort();
    assert_eq!(listed, vec!["a".to_string(), "b".to_string()]);
}

#[test]
fn cache_clear_removes_session() {
    let mut c = PermissionCache::new();
    c.add("s", "p");
    c.clear("s");
    assert!(!c.has("s", "p"));
    assert!(c.list("s").is_empty());
}

#[test]
fn cache_add_is_idempotent() {
    let mut c = PermissionCache::new();
    c.add("s", "p");
    c.add("s", "p");
    assert_eq!(c.list("s").len(), 1);
}

#[test]
fn grid_get_unset_default() {
    let g = PermissionGrid::new();
    assert_eq!(
        g.get(PermissionScope::Once, "cmd.exec.git"),
        PermissionState::Unset
    );
}

#[test]
fn grid_set_then_get_returns_value() {
    let mut g = PermissionGrid::new();
    g.set(PermissionScope::Session, "cmd.exec.git", PermissionState::Allow);
    assert_eq!(
        g.get(PermissionScope::Session, "cmd.exec.git"),
        PermissionState::Allow
    );
}

#[test]
fn grid_set_unset_removes_cell() {
    let mut g = PermissionGrid::new();
    g.set(PermissionScope::Once, "r", PermissionState::Allow);
    g.set(PermissionScope::Once, "r", PermissionState::Unset);
    assert_eq!(g.get(PermissionScope::Once, "r"), PermissionState::Unset);
}

#[test]
fn grid_scopes_are_independent() {
    let mut g = PermissionGrid::new();
    g.set(PermissionScope::Once, "r", PermissionState::Allow);
    g.set(PermissionScope::Session, "r", PermissionState::Deny);
    assert_eq!(g.get(PermissionScope::Once, "r"), PermissionState::Allow);
    assert_eq!(g.get(PermissionScope::Session, "r"), PermissionState::Deny);
    assert_eq!(g.get(PermissionScope::Always, "r"), PermissionState::Unset);
}

#[test]
fn grid_export_roundtrips_through_serde() {
    let mut g = PermissionGrid::new();
    g.set(PermissionScope::Once, "a", PermissionState::Allow);
    g.set(PermissionScope::Session, "b", PermissionState::Deny);
    let rows = g.export_rows();
    let json_s = serde_json::to_string(&rows).unwrap();
    let back: Vec<super::permission_grid::PermissionRow> =
        serde_json::from_str(&json_s).unwrap();
    assert_eq!(back.len(), 2);
}
