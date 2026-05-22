//! Cross-platform push notifications per spec §0.21.
//!
//! Trait + `OnceLock<Arc<dyn Notifier>>` global. Tauri injects a `TauriNotifier`
//! at startup using the native Tauri notification plugin. Fallback
//! `DefaultNotifier` uses platform-specific shells (macOS osascript, Linux
//! notify-rust, Windows PowerShell toast).

use serde::{Deserialize, Serialize};
use std::sync::{Arc, OnceLock};

#[derive(Debug, thiserror::Error)]
pub enum NotifyError {
    #[error("notification backend failed: {0}")]
    Backend(String),
    #[error("notifier not initialized")]
    NotInitialized,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Urgency {
    Low,
    Normal,
    Critical,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Notification {
    pub title: String,
    pub body: String,
    pub urgency: Urgency,
    pub sound: Option<String>,
}

pub trait Notifier: Send + Sync {
    fn notify(&self, notification: Notification) -> Result<(), NotifyError>;
}

static GLOBAL_NOTIFIER: OnceLock<Arc<dyn Notifier>> = OnceLock::new();

pub fn set_global_notifier(notifier: Arc<dyn Notifier>) {
    if GLOBAL_NOTIFIER.set(notifier).is_err() {
        tracing::warn!("global notifier already set; ignoring re-initialization");
    }
}

pub fn fire(n: Notification) {
    match GLOBAL_NOTIFIER.get() {
        None => tracing::warn!(
            "no global notifier set; dropping notification: {}",
            n.title
        ),
        Some(notifier) => {
            if let Err(e) = notifier.notify(n.clone()) {
                tracing::error!(error = %e, title = %n.title, "notification failed");
            }
        }
    }
}

/// Escapes characters that would break out of an AppleScript double-quoted string.
///
/// Without this, a `Notification.title` like
/// `feature/"; do shell script "rm -rf /"; --` would terminate the
/// surrounding `"..."` literal and the rest of the input would be parsed as
/// AppleScript code — a remote code execution path because Smart Attention
/// sources these strings from PR titles and branch names.
///
/// Compiled on macOS (used by `DefaultNotifier`) and under `cfg(test)` so the
/// regression tests run on every host.
#[cfg(any(target_os = "macos", test))]
pub(crate) fn applescript_escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

/// Default platform-native notifier (used when Tauri is not present).
pub struct DefaultNotifier;

#[cfg(target_os = "macos")]
impl Notifier for DefaultNotifier {
    fn notify(&self, n: Notification) -> Result<(), NotifyError> {
        let body = applescript_escape(&n.body);
        let title = applescript_escape(&n.title);
        let script = format!(
            "display notification \"{}\" with title \"{}\"",
            body, title
        );
        match std::process::Command::new("osascript")
            .args(["-e", &script])
            .spawn()
        {
            Ok(mut child) => {
                // Reap to avoid zombie. osascript is fast (< 100ms typical).
                let _ = child.wait();
                Ok(())
            }
            Err(e) => Err(NotifyError::Backend(format!("osascript spawn: {e}"))),
        }
    }
}

#[cfg(target_os = "linux")]
impl Notifier for DefaultNotifier {
    fn notify(&self, n: Notification) -> Result<(), NotifyError> {
        notify_rust::Notification::new()
            .summary(&n.title)
            .body(&n.body)
            .urgency(match n.urgency {
                Urgency::Low => notify_rust::Urgency::Low,
                Urgency::Normal => notify_rust::Urgency::Normal,
                Urgency::Critical => notify_rust::Urgency::Critical,
            })
            .show()
            .map(|_| ())
            .map_err(|e| NotifyError::Backend(format!("{e}")))
    }
}

#[cfg(target_os = "windows")]
impl Notifier for DefaultNotifier {
    fn notify(&self, n: Notification) -> Result<(), NotifyError> {
        // Windows toast via PowerShell — see spec §0.21 for full implementation.
        // Stub for now; logs at warn so production builds (which filter info)
        // still leave a breadcrumb that a notification was dropped.
        tracing::warn!(
            title = %n.title,
            body = %n.body,
            "windows notifications are not implemented yet — toast notification skipped"
        );
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::applescript_escape;

    #[test]
    fn escapes_quotes_and_backslashes() {
        assert_eq!(applescript_escape("foo \"bar\""), r#"foo \"bar\""#);
        assert_eq!(
            applescript_escape("path\\with\\backslash"),
            r#"path\\with\\backslash"#
        );
        assert_eq!(applescript_escape("clean text"), "clean text");
    }

    #[test]
    fn neutralizes_injection_attempt() {
        let evil = r#""; do shell script "rm -rf /"; --"#;
        let escaped = applescript_escape(evil);
        // The injection sequence \" cannot terminate the surrounding string
        // because the leading " has become \".
        assert!(!escaped.starts_with('"'));
        assert!(escaped.starts_with(r#"\""#));
    }
}
