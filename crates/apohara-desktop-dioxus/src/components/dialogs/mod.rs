//! Dialog components — Sprint 17 G2.B.4 Wave A.
//!
//! - `PermissionDialog`: modal that asks the user to approve / deny a tool
//!   invocation. Render-only in this sprint; Sprint 18 wires the real
//!   handler to `apohara_safety::tauri_bridge::safety_check_permission`.
//! - `ToastDialog`: Sonner-style toast container stub. Empty by design —
//!   Sprint 18 G2.C swaps it for the real Sonner-equivalent.

pub mod permission_dialog;
pub mod toast_dialog;

pub use permission_dialog::{PermissionDialog, PermissionScope};
pub use toast_dialog::ToastDialog;

#[cfg(test)]
mod dialogs_test;
