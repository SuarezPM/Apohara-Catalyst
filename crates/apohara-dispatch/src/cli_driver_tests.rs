//! Tests for the CLI subprocess driver (ported from `src/providers/cli-driver.ts`).
//!
//! Security focus: validate the sanitize-then-overlay env pattern (§0.4 + Sprint 5
//! G5.C.4 composeWorktreeEnv). Pre-`33d6901` regression test ensures
//! ANTHROPIC_API_KEY and friends never leak from parent process env.

use crate::cli_driver::{build_spawn_env, CliDriver, DispatchRequest};
use std::collections::HashMap;

#[test]
fn spawn_env_strips_secrets_then_overlays_apohara_markers() {
    let mut parent = HashMap::new();
    parent.insert("ANTHROPIC_API_KEY".to_string(), "should-not-leak".to_string());
    parent.insert("PATH".to_string(), "/usr/bin".to_string());
    parent.insert("HOME".to_string(), "/home/user".to_string());

    let runner_policy = r#"{"preset":"Balanced"}"#;
    let workspace = "/tmp/wt-abc";

    let env = build_spawn_env(&parent, workspace, runner_policy);

    assert!(
        !env.contains_key("ANTHROPIC_API_KEY"),
        "API key must be stripped"
    );
    assert_eq!(env.get("PATH").map(String::as_str), Some("/usr/bin"));
    assert_eq!(env.get("APOHARA_DRIVEN").map(String::as_str), Some("1"));
    assert_eq!(
        env.get("APOHARA_RUNNER_POLICY").map(String::as_str),
        Some(runner_policy)
    );
}

#[test]
fn spawn_env_overlays_worktree_env_but_apohara_markers_win() {
    let parent = HashMap::new();
    let runner_policy = r#"{"preset":"Balanced"}"#;
    let workspace = "/tmp/wt-test-overlay";
    std::fs::create_dir_all(workspace).ok();
    std::fs::write(
        format!("{}/.env", workspace),
        "APOHARA_DRIVEN=0\nMY_PROJECT_FLAG=ok\n",
    )
    .unwrap();

    let env = build_spawn_env(&parent, workspace, runner_policy);

    assert_eq!(env.get("MY_PROJECT_FLAG").map(String::as_str), Some("ok"));
    assert_eq!(
        env.get("APOHARA_DRIVEN").map(String::as_str),
        Some("1"),
        "APOHARA_* markers always win over .env"
    );

    std::fs::remove_dir_all(workspace).ok();
}

// Smoke check: the public types from G1.A.1 lib.rs `pub use` must remain importable.
#[test]
fn dispatch_request_constructs_with_plan_shape() {
    let _ = DispatchRequest {
        provider_id: "claude-code-cli".into(),
        workspace: "/tmp/wt".into(),
        prompt: "hello".into(),
        role: "implementer".into(),
        runner_policy: "{}".into(),
    };
    // CliDriver type exists (unit struct from impl)
    let _driver: CliDriver = CliDriver;
}
