//! G2.A.2 — smoke test for the desktop crate's IPC surface.
//!
//! We exercise `dispatch_run_inner` directly so the harness does not need a
//! webview / Tauri app context — that pattern matches the Phase 1 split
//! where Tauri commands wrap an inner async fn (see
//! `crates/apohara-dispatch/src/cli_driver.rs`).

use apohara_desktop_dioxus::commands::{dispatch_run_inner, DispatchError, RunId};

#[tokio::test]
async fn dispatch_run_inner_returns_run_id() {
    let result = dispatch_run_inner("hello world".into(), "coder".into()).await;
    assert!(matches!(result, Ok(RunId(_))), "expected Ok(RunId), got {result:?}");
    let RunId(id) = result.unwrap();
    assert!(!id.is_empty(), "run id must be non-empty");
    assert!(id.starts_with("run-coder-"), "id encodes role: {id}");
}

#[tokio::test]
async fn dispatch_run_inner_rejects_empty_prompt() {
    let err = dispatch_run_inner("   ".into(), "coder".into())
        .await
        .expect_err("empty prompt should error");
    assert!(matches!(err, DispatchError::EmptyPrompt));
}

#[tokio::test]
async fn dispatch_run_inner_rejects_empty_role() {
    let err = dispatch_run_inner("plan".into(), "".into())
        .await
        .expect_err("empty role should error");
    assert!(matches!(err, DispatchError::EmptyRole));
}
