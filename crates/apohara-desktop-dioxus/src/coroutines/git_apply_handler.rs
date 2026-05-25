//! `git_apply_handler` coroutine — applies the accepted diff to the working
//! tree. Receives `GitApplyMsg::Accept` from the CodeDiffPane Accept button,
//! runs `git apply` on `CODE_DIFF.unified`, and toasts the result (W4.7).

use dioxus::prelude::*;
use futures_util::StreamExt;
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};

use crate::state::code_diff::CODE_DIFF;
use crate::state::toast_queue::{self, Toast, ToastLevel};

/// Handle to the git-apply coroutine, published so the Accept button can `.send()`.
pub static GIT_APPLY_TX: GlobalSignal<Option<Coroutine<GitApplyMsg>>> = Signal::global(|| None);

/// Messages the git-apply handler accepts.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum GitApplyMsg {
    /// Apply the current `CODE_DIFF` to the working tree.
    Accept,
}

/// Mount the coroutine and publish its handle.
pub fn mount() {
    let tx = use_coroutine(|mut rx: UnboundedReceiver<GitApplyMsg>| async move {
        while let Some(GitApplyMsg::Accept) = rx.next().await {
            let unified = CODE_DIFF.read().as_ref().map(|d| d.unified.clone());
            if let Some(unified) = unified {
                let result = apply_diff(&unified, Path::new("."));
                toast_queue::push(apply_result_toast(&result));
            }
        }
    });
    use_effect(move || {
        *GIT_APPLY_TX.write() = Some(tx);
    });
}

/// Apply a unified diff to the working tree at `repo` via `git apply`, feeding
/// the patch through stdin. Returns Ok on a clean apply, Err with git's stderr.
pub(crate) fn apply_diff(unified: &str, repo: &Path) -> Result<(), String> {
    let mut child = Command::new("git")
        .arg("-C")
        .arg(repo)
        .arg("apply")
        .arg("-")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn git apply: {e}"))?;
    child
        .stdin
        .take()
        .ok_or_else(|| "git apply stdin unavailable".to_string())?
        .write_all(unified.as_bytes())
        .map_err(|e| format!("write patch: {e}"))?;
    let out = child
        .wait_with_output()
        .map_err(|e| format!("wait git apply: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// Build the toast that reports a git-apply outcome.
pub(crate) fn apply_result_toast(result: &Result<(), String>) -> Toast {
    let (level, message) = match result {
        Ok(()) => (
            ToastLevel::Success,
            "Diff applied to the working tree.".to_string(),
        ),
        Err(e) => (ToastLevel::Error, format!("git apply failed: {e}")),
    };
    static SEQ: AtomicU64 = AtomicU64::new(0);
    Toast {
        id: format!("git-apply-{}", SEQ.fetch_add(1, Ordering::Relaxed)),
        level,
        message,
        created_at: std::time::Instant::now(),
        ttl_ms: 6000,
    }
}
