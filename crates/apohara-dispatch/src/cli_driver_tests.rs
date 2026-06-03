//! Tests for the CLI subprocess driver (ported from `src/providers/cli-driver.ts`).
//!
//! Security focus: validate the sanitize-then-overlay env pattern (§0.4 + Sprint 5
//! G5.C.4 composeWorktreeEnv). Pre-`33d6901` regression test ensures
//! ANTHROPIC_API_KEY and friends never leak from parent process env.

use crate::cli_driver::{binary_lock, build_spawn_env, CliDriver, DispatchRequest};
use std::collections::HashMap;

#[test]
fn spawn_env_strips_secrets_then_overlays_apohara_markers() {
    let mut parent = HashMap::new();
    parent.insert("ANTHROPIC_API_KEY".to_string(), "should-not-leak".to_string());
    parent.insert("PATH".to_string(), "/usr/bin".to_string());
    parent.insert("HOME".to_string(), "/home/user".to_string());

    let runner_policy = r#"{"preset":"Balanced"}"#;
    let workspace = "/tmp/wt-abc";

    let env = build_spawn_env(&parent, workspace, runner_policy, None, None);

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
    // No hook context supplied → no correlation vars exported.
    assert!(!env.contains_key("APOHARA_PANE_KEY"));
    // No isolation requested → CLAUDE_CONFIG_DIR is not injected.
    assert!(!env.contains_key("CLAUDE_CONFIG_DIR"));
}

// US-F1.4: per-blade isolation injects CLAUDE_CONFIG_DIR post-sanitization,
// WITHOUT touching HOME. Pins the two load-bearing facts: (1) the isolation var
// is exactly the requested dir, (2) HOME stays the sanitized parent value — it
// is NOT redirected to the isolation dir (HOME override is the auth/billing
// danger zone). Secrets remain stripped, proving isolation rides on top of the
// allowlist rather than reopening it.
#[test]
fn spawn_env_injects_config_isolation_without_touching_home() {
    let mut parent = HashMap::new();
    parent.insert("ANTHROPIC_API_KEY".to_string(), "should-not-leak".to_string());
    parent.insert("PATH".to_string(), "/usr/bin".to_string());
    parent.insert("HOME".to_string(), "/home/user".to_string());

    let runner_policy = r#"{"preset":"Balanced"}"#;
    let env = build_spawn_env(
        &parent,
        "/tmp/wt",
        runner_policy,
        None,
        Some("/tmp/blade-x/.claude"),
    );

    // Isolation var present and exactly the requested per-blade dir.
    assert_eq!(
        env.get("CLAUDE_CONFIG_DIR").map(String::as_str),
        Some("/tmp/blade-x/.claude")
    );
    // Secret still stripped — isolation does not reopen the allowlist.
    assert!(
        !env.contains_key("ANTHROPIC_API_KEY"),
        "API key must be stripped"
    );
    // HOME is the sanitized parent value, NOT the isolation dir. Overriding
    // HOME is the wrong-account-billed danger zone; we isolate via
    // CLAUDE_CONFIG_DIR only.
    assert_eq!(env.get("HOME").map(String::as_str), Some("/home/user"));
    assert_ne!(
        env.get("HOME").map(String::as_str),
        Some("/tmp/blade-x/.claude"),
        "HOME must not be redirected to the isolation dir"
    );
}

#[test]
fn spawn_env_exports_hook_correlation_vars_without_leaking_secrets() {
    use crate::cli_driver::HookContext;

    let mut parent = HashMap::new();
    parent.insert("OPENAI_API_KEY".to_string(), "should-not-leak".to_string());
    parent.insert("PATH".to_string(), "/usr/bin".to_string());

    let hooks = HookContext {
        pane_key: "pane-7".to_string(),
        task_id: Some("task-42".to_string()),
        worktree_id: Some("wt-99".to_string()),
        phase: Some("plan".to_string()),
    };
    let env = build_spawn_env(&parent, "/tmp/wt", "{}", Some(&hooks), None);

    // §0.4: the hook vars are exported but the host secret is still stripped.
    assert!(!env.contains_key("OPENAI_API_KEY"), "secret must be stripped");
    assert_eq!(env.get("APOHARA_PANE_KEY").map(String::as_str), Some("pane-7"));
    assert_eq!(env.get("APOHARA_TASK_ID").map(String::as_str), Some("task-42"));
    assert_eq!(env.get("APOHARA_WORKTREE_ID").map(String::as_str), Some("wt-99"));
    // US-S4 — the mesh phase rides the same hook context for the CLI claim-guard.
    assert_eq!(env.get("APOHARA_PHASE").map(String::as_str), Some("plan"));
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

    let env = build_spawn_env(&parent, workspace, runner_policy, None, None);

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
        pane_key: String::new(),
        task_id: None,
        worktree_id: None,
        config_isolation: None,
        phase: None,
        provider_kind: None,
    };
    // CliDriver type exists (unit struct from impl)
    let _driver: CliDriver = CliDriver;
}

// W1.C.1: streaming dispatch forwards each stdout line to `on_line`.
// Uses `/bin/echo` directly — NOT `bash -c "echo X"` — per the PTY/flush
// incident (bash exits before flushing; /bin/echo is the stable case).
#[tokio::test]
async fn dispatch_streaming_invokes_on_line_per_stdout_line() {
    use std::sync::{Arc, Mutex};

    let req = DispatchRequest {
        provider_id: "/bin/echo".into(),
        workspace: "/tmp".into(),
        prompt: "stream-line-test".into(),
        role: "test".into(),
        runner_policy: "{}".into(),
        pane_key: String::new(),
        task_id: None,
        worktree_id: None,
        config_isolation: None,
        phase: None,
        provider_kind: None,
    };

    let lines = Arc::new(Mutex::new(Vec::<String>::new()));
    let sink = Arc::clone(&lines);
    let outcome = CliDriver::dispatch_streaming(req, move |line| {
        sink.lock().unwrap().push(line);
    })
    .await
    .unwrap();

    assert!(outcome.success, "echo should exit 0");
    let captured = lines.lock().unwrap();
    assert!(
        captured.iter().any(|l| l.contains("stream-line-test")),
        "on_line should have received the streamed line; got {captured:?}"
    );
    assert!(outcome.output.contains("stream-line-test"));
}

// US-F1.4: the per-binary FIFO lock (`runSerialized`) is keyed by binary
// basename. Same id ⇒ same `Arc` (so two dispatches of that binary serialize on
// one lock); different ids ⇒ distinct `Arc`s (so different binaries run in
// parallel). Deterministic — no spawn, just identity of the lock registry.
#[test]
fn binary_lock_is_per_binary() {
    let a = binary_lock("claude");
    let b = binary_lock("claude");
    assert!(
        std::sync::Arc::ptr_eq(&a, &b),
        "same binary must share one FIFO lock"
    );

    let codex = binary_lock("codex");
    assert!(
        !std::sync::Arc::ptr_eq(&a, &codex),
        "different binaries must get distinct locks (parallel-capable)"
    );

    // Keyed by basename: a full path and the bare name collapse to one lock,
    // since they hit the same on-disk CLI's internal locks.
    let by_path = binary_lock("/usr/bin/claude");
    assert!(
        std::sync::Arc::ptr_eq(&a, &by_path),
        "path and bare basename must map to the same lock"
    );
}

// US-F1.4 no-hang proof: two concurrent serialized dispatches of the SAME
// binary must both complete (neither blocks to a 120s SIGKILL). Uses `/bin/echo`
// — NOT a real agent CLI and NOT `bash -c` (flush incident) — so it finishes
// fast and deterministically. We also prove genuine exclusion: while the first
// guard is held, `try_lock` on the same basename fails.
#[tokio::test]
async fn serialized_same_binary_does_not_deadlock() {
    let mk = || DispatchRequest {
        provider_id: "/bin/echo".into(),
        workspace: "/tmp".into(),
        prompt: "serialize-test".into(),
        role: "test".into(),
        runner_policy: "{}".into(),
        pane_key: String::new(),
        task_id: None,
        worktree_id: None,
        config_isolation: None,
        phase: None,
        provider_kind: None,
    };

    // Exclusion check: hold the basename's guard and confirm a second acquirer
    // cannot take it concurrently (proves mutual exclusion, not just liveness).
    {
        let lock = binary_lock("/bin/echo");
        let _held = lock.lock().await;
        assert!(
            binary_lock("echo").try_lock().is_err(),
            "same-basename lock must be exclusive while held"
        );
    } // guard dropped here → lock free again for the join below

    // Two concurrent same-binary dispatches: they queue FIFO on the one lock
    // and BOTH succeed. If serialization deadlocked, this join would hang the
    // test (caught by the test harness timeout) instead of returning two Ok.
    let (r1, r2) = tokio::join!(
        CliDriver::dispatch_streaming_serialized(mk(), |_| {}),
        CliDriver::dispatch_streaming_serialized(mk(), |_| {}),
    );
    assert!(r1.is_ok(), "first serialized dispatch failed: {r1:?}");
    assert!(r2.is_ok(), "second serialized dispatch failed: {r2:?}");
    assert!(r1.unwrap().success);
    assert!(r2.unwrap().success);
}

// US-S1: ProviderKind maps the three canonical roster ids and rejects unknowns.
// The roster id (ActiveProvider.id) is the authoritative source — never the
// binary basename.
#[test]
fn provider_kind_from_roster_id_maps_active_providers() {
    use crate::cli_driver::ProviderKind;
    assert_eq!(
        ProviderKind::from_roster_id("claude-code-cli"),
        Some(ProviderKind::Claude)
    );
    assert_eq!(
        ProviderKind::from_roster_id("codex-cli"),
        Some(ProviderKind::Codex)
    );
    assert_eq!(
        ProviderKind::from_roster_id("opencode-go"),
        Some(ProviderKind::Opencode)
    );
    assert_eq!(ProviderKind::from_roster_id("gemini"), None);
    assert_eq!(ProviderKind::from_roster_id(""), None);
}

// US-S1: `provider_kind` is additive — a wire payload WITHOUT the field
// deserializes to `None` (backward-compatible). Pins that existing serialized
// DispatchRequests keep working after the field was added.
#[test]
fn dispatch_request_without_provider_kind_deserializes_to_none() {
    let json = r#"{"provider_id":"claude","workspace":"/tmp","prompt":"hi","role":"impl","runner_policy":"{}"}"#;
    let req: DispatchRequest = serde_json::from_str(json).unwrap();
    assert_eq!(req.provider_kind, None);
}

// ===================================================================
// US-S2 — build_command_spec: per-provider headless dialect (pure, no CLIs).
// ===================================================================

/// True if `args` contains the adjacent flag pair `[a, b]` (e.g. a flag and its
/// value). Avoids the `&[String] == [&str; N]` type mismatch by comparing
/// element-by-element.
fn flag_pair(args: &[String], a: &str, b: &str) -> bool {
    args.windows(2).any(|w| w[0] == a && w[1] == b)
}

// US-S2: ProviderKind=None reproduces the legacy `--print` spawn BYTE-FOR-BYTE
// (backward-compat + the APOHARA_DIALECT_LEGACY rollback target).
#[test]
fn spec_legacy_none_is_byte_identical_print() {
    use crate::cli_driver::build_command_spec;
    let req = DispatchRequest {
        provider_id: "/usr/bin/claude".into(),
        prompt: "do the thing".into(),
        ..Default::default()
    };
    let spec = build_command_spec(None, &req);
    assert_eq!(spec.program, "/usr/bin/claude");
    assert_eq!(
        spec.args,
        vec!["--print".to_string(), "do the thing".to_string()]
    );
    assert_eq!(spec.stdin, None);
}

// US-S2: claude headless-write dialect — flags present, prompt rides the
// stream-json stdin envelope (NOT argv), and the envelope carries the prompt.
#[test]
fn spec_claude_dialect_prompt_via_stdin_envelope() {
    use crate::cli_driver::{build_command_spec, ProviderKind};
    let req = DispatchRequest {
        provider_id: "/usr/bin/claude".into(),
        prompt: "improve foo".into(),
        ..Default::default()
    };
    let spec = build_command_spec(Some(ProviderKind::Claude), &req);
    // Full byte-exact dialect — blinds against any flag drift. claude REQUIRES
    // `--verbose` together with `--output-format stream-json`, so a dropped flag
    // would fail at runtime; the complete assert catches it at test time.
    let expected: Vec<String> = [
        "-p",
        "--output-format",
        "stream-json",
        "--input-format",
        "stream-json",
        "--verbose",
        "--permission-mode",
        "bypassPermissions",
        "--disallowedTools",
        "AskUserQuestion",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    assert_eq!(spec.args, expected);
    // Prompt rides stdin, NEVER argv.
    assert!(
        !spec.args.iter().any(|a| a.contains("improve foo")),
        "prompt must not appear in argv"
    );
    let stdin = spec.stdin.expect("claude dialect uses stdin");
    let v: serde_json::Value = serde_json::from_str(stdin.trim()).unwrap();
    assert_eq!(v["message"]["content"][0]["text"], "improve foo");
}

// US-S2: the claude stdin envelope escapes quotes / newlines / unicode correctly
// (the reason build_command_spec uses serde_json, not string concatenation).
// Roundtrips a hostile prompt through the envelope and back.
#[test]
fn spec_claude_envelope_escapes_quotes_newlines_unicode() {
    use crate::cli_driver::{build_command_spec, ProviderKind};
    let hostile = "say \"hi\"\nand 日本語 🎉 \\ end";
    let req = DispatchRequest {
        provider_id: "/usr/bin/claude".into(),
        prompt: hostile.into(),
        ..Default::default()
    };
    let spec = build_command_spec(Some(ProviderKind::Claude), &req);
    let stdin = spec.stdin.expect("claude dialect uses stdin");
    // Must parse as valid JSON despite the embedded quotes/newline/backslash.
    let v: serde_json::Value = serde_json::from_str(stdin.trim()).unwrap();
    // And the text survives the roundtrip byte-for-byte.
    assert_eq!(v["message"]["content"][0]["text"], hostile);
}

// US-S2: codex headless-write dialect — ALWAYS `exec`, sandbox workspace-write,
// trailing `-` (prompt via stdin), NEVER `--full-auto` (deprecated).
#[test]
fn spec_codex_dialect_exec_prompt_via_stdin() {
    use crate::cli_driver::{build_command_spec, ProviderKind};
    let req = DispatchRequest {
        provider_id: "/home/u/.local/bin/codex".into(),
        prompt: "add a test".into(),
        ..Default::default()
    };
    let spec = build_command_spec(Some(ProviderKind::Codex), &req);
    assert_eq!(
        spec.args.first().map(String::as_str),
        Some("exec"),
        "codex must always use the exec subcommand"
    );
    assert!(spec.args.contains(&"--skip-git-repo-check".to_string()));
    assert!(flag_pair(&spec.args, "--sandbox", "workspace-write"));
    assert_eq!(
        spec.args.last().map(String::as_str),
        Some("-"),
        "codex reads the prompt from stdin via the trailing -"
    );
    assert!(
        !spec.args.contains(&"--full-auto".to_string()),
        "--full-auto is deprecated"
    );
    assert_eq!(spec.stdin.as_deref(), Some("add a test"));
    assert!(
        !spec.args.iter().any(|a| a.contains("add a test")),
        "prompt must not appear in argv"
    );
}

// US-S2: opencode headless-write dialect — `run --format json
// --dangerously-skip-permissions --dir <ws>`, prompt as the trailing positional.
#[test]
fn spec_opencode_dialect_run_prompt_positional() {
    use crate::cli_driver::{build_command_spec, ProviderKind};
    let req = DispatchRequest {
        provider_id: "/usr/bin/opencode".into(),
        workspace: "/tmp/work".into(),
        prompt: "fix the bug".into(),
        ..Default::default()
    };
    let spec = build_command_spec(Some(ProviderKind::Opencode), &req);
    assert!(spec.args.contains(&"run".to_string()));
    assert!(flag_pair(&spec.args, "--format", "json"));
    assert!(spec
        .args
        .contains(&"--dangerously-skip-permissions".to_string()));
    assert!(flag_pair(&spec.args, "--dir", "/tmp/work"));
    assert_eq!(
        spec.args.last().map(String::as_str),
        Some("fix the bug"),
        "prompt is the trailing positional arg"
    );
    assert_eq!(spec.stdin, None);
}

// US-S2 / M6 (security): build_command_spec is PURE — it never reads the
// environment, so a secret in the process env can never reach args or stdin.
// Pins the defense-in-depth invariant against a future regression that might
// interpolate env into the prompt/envelope.
#[serial_test::serial]
#[test]
fn spec_envelope_never_interpolates_environment() {
    use crate::cli_driver::{build_command_spec, ProviderKind};
    std::env::set_var("ANTHROPIC_API_KEY", "sk-secret-DO-NOT-LEAK-xyz");
    let req = DispatchRequest {
        provider_id: "/usr/bin/claude".into(),
        workspace: "/tmp/ws".into(),
        prompt: "harmless prompt".into(),
        ..Default::default()
    };
    for kind in [
        Some(ProviderKind::Claude),
        Some(ProviderKind::Codex),
        Some(ProviderKind::Opencode),
        None,
    ] {
        let spec = build_command_spec(kind, &req);
        let blob = format!("{} {:?} {:?}", spec.program, spec.args, spec.stdin);
        assert!(
            !blob.contains("sk-secret-DO-NOT-LEAK-xyz"),
            "no env VALUE may appear in the spec ({kind:?})"
        );
        assert!(
            !blob.contains("ANTHROPIC_API_KEY"),
            "no env KEY may appear in the spec ({kind:?})"
        );
    }
    std::env::remove_var("ANTHROPIC_API_KEY");
}
