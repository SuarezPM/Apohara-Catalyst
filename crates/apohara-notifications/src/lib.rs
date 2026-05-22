//! Cross-platform push notifications per spec §0.21.
//!
//! Trait + `OnceLock<Arc<dyn Notifier>>` global. Tauri injects a `TauriNotifier`
//! at startup using the native Tauri notification plugin. Fallback
//! `DefaultNotifier` uses platform-specific shells (macOS osascript, Linux
//! notify-rust, Windows PowerShell toast).

use serde::{Deserialize, Serialize};
use std::sync::{Arc, OnceLock};

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
    fn notify(&self, notification: Notification);
}

static GLOBAL_NOTIFIER: OnceLock<Arc<dyn Notifier>> = OnceLock::new();

pub fn set_global_notifier(notifier: Arc<dyn Notifier>) {
    let _ = GLOBAL_NOTIFIER.set(notifier);
}

pub fn fire(notification: Notification) {
    if let Some(notifier) = GLOBAL_NOTIFIER.get() {
        notifier.notify(notification);
    } else {
        tracing::warn!(
            "no global notifier set; dropping notification: {}",
            notification.title
        );
    }
}

/// Default platform-native notifier (used when Tauri is not present).
pub struct DefaultNotifier;

impl Notifier for DefaultNotifier {
    fn notify(&self, n: Notification) {
        #[cfg(target_os = "macos")]
        {
            let _ = std::process::Command::new("osascript")
                .args([
                    "-e",
                    &format!(
                        "display notification \"{}\" with title \"{}\"",
                        n.body, n.title
                    ),
                ])
                .spawn();
        }
        #[cfg(target_os = "linux")]
        {
            let _ = notify_rust::Notification::new()
                .summary(&n.title)
                .body(&n.body)
                .urgency(match n.urgency {
                    Urgency::Low => notify_rust::Urgency::Low,
                    Urgency::Normal => notify_rust::Urgency::Normal,
                    Urgency::Critical => notify_rust::Urgency::Critical,
                })
                .show();
        }
        #[cfg(target_os = "windows")]
        {
            // Windows toast via PowerShell — see spec §0.21 for full implementation.
            let _ = &n;
            tracing::info!("Windows toast notification not yet wired (stub)");
        }
    }
}
