//! Context warnings.
//!
//! Mirrors `src/core/hooks/context-warnings.ts` (G5.C.3).
//!
//! Watches token usage per session and emits warning events when an
//! agent approaches its context limit. Bands:
//!
//! - `ok`       (<75%): silent
//! - `caution`  (>=75%): "context filling, consider summarising soon"
//! - `warning`  (>=85%): "compaction likely imminent"
//! - `critical` (>=95%): "compaction expected within next tool call"
//!
//! De-duplication: emits only on transitions to a strictly higher band.
//! Drop-backs are silent — the band is monotonic-by-design because
//! context usage only grows mid-session. The high-water mark is kept so
//! subsequent escalations don't double-fire on the same level.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContextLevel {
    Ok = 0,
    Caution = 1,
    Warning = 2,
    Critical = 3,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ContextUsageClassification {
    pub level: ContextLevel,
    pub percent: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ContextUsageEvent {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub level: ContextLevel,
    pub percent: f32,
    #[serde(rename = "tokensUsed")]
    pub tokens_used: u64,
    #[serde(rename = "tokensLimit")]
    pub tokens_limit: u64,
}

pub fn classify_context_usage(
    tokens_used: u64,
    tokens_limit: i64,
) -> ContextUsageClassification {
    if tokens_limit <= 0 {
        return ContextUsageClassification {
            level: ContextLevel::Ok,
            percent: 0.0,
        };
    }
    let ratio = tokens_used as f64 / tokens_limit as f64;
    // Match TS: percent rounded to 1 decimal place.
    let percent = ((ratio * 1000.0).round() / 10.0) as f32;
    let level = if ratio >= 0.95 {
        ContextLevel::Critical
    } else if ratio >= 0.85 {
        ContextLevel::Warning
    } else if ratio >= 0.75 {
        ContextLevel::Caution
    } else {
        ContextLevel::Ok
    };
    ContextUsageClassification { level, percent }
}

/// Session band tracker. Thread-safe so the bridge can share a single
/// monitor across async tasks without callers wrapping it themselves.
#[derive(Debug, Default)]
pub struct ContextWarningMonitor {
    bands: Mutex<HashMap<String, ContextLevel>>,
}

#[derive(Debug, Clone)]
pub struct ObserveInput {
    pub session_id: String,
    pub tokens_used: u64,
    pub tokens_limit: u64,
}

impl ContextWarningMonitor {
    pub fn new() -> Self {
        Self::default()
    }

    /// Observe a usage sample. Returns `Some(event)` when this sample
    /// escalates the band to a strictly higher level. The TS version uses
    /// an injected emitter callback; returning the event keeps the Rust
    /// signature non-async + non-generic over a closure, which composes
    /// better with the broadcast channel the hooks-server already owns.
    pub fn observe(&self, input: ObserveInput) -> Option<ContextUsageEvent> {
        let limit_i64 = i64::try_from(input.tokens_limit).unwrap_or(i64::MAX);
        let ContextUsageClassification { level, percent } =
            classify_context_usage(input.tokens_used, limit_i64);
        let mut guard = self.bands.lock().expect("context-warnings lock poisoned");
        let previous = *guard.get(&input.session_id).unwrap_or(&ContextLevel::Ok);
        if level > previous {
            guard.insert(input.session_id.clone(), level);
            return Some(ContextUsageEvent {
                session_id: input.session_id,
                level,
                percent,
                tokens_used: input.tokens_used,
                tokens_limit: input.tokens_limit,
            });
        }
        None
    }

    pub fn forget(&self, session_id: &str) {
        let mut guard = self.bands.lock().expect("context-warnings lock poisoned");
        guard.remove(session_id);
    }

    pub fn current_band(&self, session_id: &str) -> ContextLevel {
        let guard = self.bands.lock().expect("context-warnings lock poisoned");
        *guard.get(session_id).unwrap_or(&ContextLevel::Ok)
    }
}
