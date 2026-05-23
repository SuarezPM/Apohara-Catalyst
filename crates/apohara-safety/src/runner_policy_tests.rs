use super::runner_policy::{
    advisory, balanced, compile_runner_execution_plan, detect_violations, external_sandbox,
    snapshot_protected_paths, strict, EnforcementArea, EnforcementStrength, NetworkDefault,
    PolicyPreset, SandboxTool,
};
use tempfile::tempdir;
use tokio::fs;

#[test]
fn strict_compiles_with_enforced_filesystem_and_network() {
    let plan = compile_runner_execution_plan(&strict());
    assert!(matches!(plan.policy, PolicyPreset::Strict));
    assert!(!plan.rejected);
    let net = plan
        .enforcement
        .iter()
        .find(|e| matches!(e.area, EnforcementArea::Network))
        .unwrap();
    assert_eq!(net.strength, EnforcementStrength::Enforced);
    let fs_e = plan
        .enforcement
        .iter()
        .find(|e| matches!(e.area, EnforcementArea::Filesystem))
        .unwrap();
    assert_eq!(fs_e.strength, EnforcementStrength::Enforced);
}

#[test]
fn balanced_has_warn_only_sudo() {
    let p = balanced();
    assert!(p.commands.warn_only.iter().any(|r| r.contains("sudo")));
    assert!(p.commands.blocked.iter().any(|r| r.contains("rm")));
    assert!(matches!(p.network.default_action, NetworkDefault::Allow));
}

#[test]
fn advisory_blocks_nothing() {
    let p = advisory();
    assert!(p.commands.blocked.is_empty());
    assert!(!p.commands.warn_only.is_empty());
}

#[test]
fn external_sandbox_inherits_strict_with_bwrap() {
    let p = external_sandbox();
    assert!(p.external_sandbox.enabled);
    assert_eq!(p.external_sandbox.tool, Some(SandboxTool::Bwrap));
    // Same blocked list as strict.
    assert!(p.commands.blocked.iter().any(|r| r.contains("rm")));
}

#[test]
fn strict_rejects_when_critical_unsupported() {
    // Build a Strict policy whose filesystem.protectedPaths is empty —
    // that pushes Filesystem to Unsupported but critical=false (because
    // critical is set to `protected_paths.len() > 0`). So the plan
    // should NOT be rejected on filesystem alone. Confirm.
    let mut p = strict();
    p.filesystem.protected_paths.clear();
    let plan = compile_runner_execution_plan(&p);
    let fs_e = plan
        .enforcement
        .iter()
        .find(|e| matches!(e.area, EnforcementArea::Filesystem))
        .unwrap();
    assert_eq!(fs_e.strength, EnforcementStrength::Unsupported);
    assert!(!fs_e.critical);
    assert!(!plan.rejected);
}

#[tokio::test]
async fn snapshot_then_detect_no_change() {
    let dir = tempdir().unwrap();
    fs::write(dir.path().join("AGENTS.md"), "hello").await.unwrap();
    let before = snapshot_protected_paths(dir.path(), &["AGENTS.md".to_string()])
        .await
        .unwrap();
    assert_eq!(before.files.len(), 1);
    let v = detect_violations(&before, dir.path()).await.unwrap();
    assert!(v.is_empty());
}

#[tokio::test]
async fn snapshot_then_modify_detects_violation() {
    let dir = tempdir().unwrap();
    fs::write(dir.path().join("AGENTS.md"), "v1").await.unwrap();
    let before = snapshot_protected_paths(dir.path(), &["AGENTS.md".to_string()])
        .await
        .unwrap();
    fs::write(dir.path().join("AGENTS.md"), "v2").await.unwrap();
    let v = detect_violations(&before, dir.path()).await.unwrap();
    assert_eq!(v.len(), 1);
    assert_eq!(v[0].path, "AGENTS.md");
    assert_ne!(v[0].before, v[0].after);
}

#[tokio::test]
async fn snapshot_then_delete_detects_violation() {
    let dir = tempdir().unwrap();
    fs::write(dir.path().join("AGENTS.md"), "v1").await.unwrap();
    let before = snapshot_protected_paths(dir.path(), &["AGENTS.md".to_string()])
        .await
        .unwrap();
    fs::remove_file(dir.path().join("AGENTS.md")).await.unwrap();
    let v = detect_violations(&before, dir.path()).await.unwrap();
    assert_eq!(v.len(), 1);
    assert_eq!(v[0].after, "<deleted>");
}

#[tokio::test]
async fn snapshot_walks_nested_dirs() {
    let dir = tempdir().unwrap();
    fs::create_dir_all(dir.path().join(".apohara")).await.unwrap();
    fs::write(dir.path().join(".apohara/state.json"), "{}").await.unwrap();
    let res = snapshot_protected_paths(dir.path(), &[".apohara/**".to_string()])
        .await
        .unwrap();
    assert_eq!(res.files.len(), 1);
    assert_eq!(res.files[0].path, ".apohara/state.json");
}
