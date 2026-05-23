//! IPC commands exposed by the Dioxus desktop bake-off.
//!
//! Sprint 16 (G2.A) scope: prove that a Rust async function can be reached
//! from the Dioxus UI through Dioxus's own `use_resource` / `spawn` hooks.
//! Real `apohara-dispatch` wiring lands in Phase 3 once the desktop crate
//! takes over from `packages/desktop/src-tauri`.
//!
//! Why we are NOT coupling to `apohara-dispatch::CliDriver::dispatch` yet:
//!   - That function spawns the real provider binary (`claude`, `codex`,
//!     ...). Unit tests cannot rely on those being installed.
//!   - The bake-off only needs to validate the Rust-callable surface, not
//!     end-to-end dispatch.

use anyhow::Result;
use serde::{Deserialize, Serialize};

/// Synthetic identifier returned by [`dispatch_run_inner`].
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RunId(pub String);

/// Validation error surfaced when the UI sends an empty prompt or role.
#[derive(Debug, thiserror::Error)]
pub enum DispatchError {
    #[error("prompt must not be empty")]
    EmptyPrompt,
    #[error("role must not be empty")]
    EmptyRole,
}

/// Inner async fn exposable to tests without the `#[tauri::command]` macro
/// dance — same shape we intend to use when we replace the synthetic id with
/// a real `apohara_dispatch::CliDriver::dispatch` call in Phase 3.
pub async fn dispatch_run_inner(prompt: String, role: String) -> Result<RunId, DispatchError> {
    if prompt.trim().is_empty() {
        return Err(DispatchError::EmptyPrompt);
    }
    if role.trim().is_empty() {
        return Err(DispatchError::EmptyRole);
    }
    // v7-style id keeps the surface stable; replace with the real dispatch
    // outcome's run_id in Phase 3.
    Ok(RunId(format!("run-{}-{}", role, prompt.len())))
}
