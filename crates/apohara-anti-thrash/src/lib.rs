//! Strategy-rotation anti-loop (symphony #16, G5.G.10).
//!
//! Rust counterpart of the TS `FailureTracker` in
//! `src/core/anti-thrash/strategyRotation.ts`. Same contract: per-tool
//! consecutive-failure counter that emits a `RotationAlert` once a
//! threshold is reached, telling the caller to inject a "stop and try
//! something else" directive into the agent's next turn.
//!
//! Why a Rust copy: hot paths in the sandbox runner and the indexer
//! need to consult the counter without a JS round-trip. The on-disk
//! file format is identical to the TS side so both can read each
//! other's state across the worker boundary.
//!
//! Persistence is intentionally NOT wired here: the bare struct is
//! pure in-memory so callers can opt into whatever durability suits
//! them (the persistence crate ships an atomic write helper).
//!
//! G7.5.A.9 wiring: the dashboard humanizer (TS) and the equivalent
//! Rust consumers consult the tracker via `StrategyTracker::peek` —
//! a non-mutating read that returns the current per-tool count. Calling
//! `record_failure` to read the count would itself trip the threshold,
//! so `peek` is the only safe path for read-only surfaces (UI labels,
//! audit lines, telemetry).

use serde::{Deserialize, Serialize};

/// Tool families the tracker recognises. Matches the TS ToolKind enum.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ToolKind {
    Bash,
    Edit,
    Write,
    Web,
    Other,
}

/// Persistent counter shape. Matches the JSON written by the TS
/// `FailureTracker` so both sides can read each other's state files.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct FailureCounts {
    #[serde(default)]
    pub bash_failures: u32,
    #[serde(default)]
    pub edit_failures: u32,
    #[serde(default)]
    pub write_failures: u32,
    #[serde(default)]
    pub web_failures: u32,
    #[serde(default)]
    pub last_failure_at: i64,
}

impl FailureCounts {
    pub fn get(&self, tool: ToolKind) -> u32 {
        match tool {
            ToolKind::Bash => self.bash_failures,
            ToolKind::Edit => self.edit_failures,
            ToolKind::Write => self.write_failures,
            ToolKind::Web => self.web_failures,
            ToolKind::Other => 0,
        }
    }

    fn bump(&mut self, tool: ToolKind, delta: i32) {
        let apply = |v: &mut u32| {
            if delta < 0 {
                *v = v.saturating_sub((-delta) as u32);
            } else {
                *v = v.saturating_add(delta as u32);
            }
        };
        match tool {
            ToolKind::Bash => apply(&mut self.bash_failures),
            ToolKind::Edit => apply(&mut self.edit_failures),
            ToolKind::Write => apply(&mut self.write_failures),
            ToolKind::Web => apply(&mut self.web_failures),
            ToolKind::Other => {}
        }
    }

    fn reset(&mut self, tool: ToolKind) {
        match tool {
            ToolKind::Bash => self.bash_failures = 0,
            ToolKind::Edit => self.edit_failures = 0,
            ToolKind::Write => self.write_failures = 0,
            ToolKind::Web => self.web_failures = 0,
            ToolKind::Other => {}
        }
    }
}

/// Result of a `record_failure` call. `triggered=true` means the tool
/// just crossed the threshold; caller should surface `additional_context`
/// to the agent (typically via the hookSpecificOutput).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RotationAlert {
    pub triggered: bool,
    pub tool: ToolKind,
    pub failure_count: u32,
    pub additional_context: String,
}

/// In-memory strategy-rotation tracker. Per-tool consecutive-failure
/// counter; success on a tool clears that tool's count.
#[derive(Debug, Clone)]
pub struct StrategyTracker {
    counts: FailureCounts,
    threshold: u32,
}

impl StrategyTracker {
    pub fn new(threshold: u32) -> Self {
        Self {
            counts: FailureCounts::default(),
            threshold: threshold.max(1),
        }
    }

    /// Build a tracker pre-populated from a persisted snapshot.
    pub fn from_counts(counts: FailureCounts, threshold: u32) -> Self {
        Self {
            counts,
            threshold: threshold.max(1),
        }
    }

    /// Record one failure for `tool`. Returns the alert; if the tool
    /// just hit the threshold, `triggered=true` and the caller should
    /// inject `additional_context` into the agent's next turn.
    pub fn record_failure(&mut self, tool: ToolKind, now_ms: i64) -> RotationAlert {
        self.counts.bump(tool, 1);
        self.counts.last_failure_at = now_ms;
        let failure_count = self.counts.get(tool);
        let triggered = failure_count >= self.threshold;
        RotationAlert {
            triggered,
            tool,
            failure_count,
            additional_context: if triggered {
                rotation_directive(tool, failure_count)
            } else {
                String::new()
            },
        }
    }

    /// Record one success. Resets the per-tool counter so the next
    /// failure starts the streak over.
    pub fn record_success(&mut self, tool: ToolKind) {
        if self.counts.get(tool) == 0 {
            return;
        }
        self.counts.reset(tool);
    }

    /// Look up the current count for `tool` without modifying state.
    pub fn peek(&self, tool: ToolKind) -> u32 {
        self.counts.get(tool)
    }

    /// Snapshot the counts for persistence.
    pub fn snapshot(&self) -> FailureCounts {
        self.counts.clone()
    }

    /// Reset all counters in-place. Equivalent to dropping and
    /// constructing a fresh tracker with the same threshold.
    pub fn reset_all(&mut self) {
        self.counts = FailureCounts::default();
    }
}

fn rotation_directive(tool: ToolKind, count: u32) -> String {
    let tool_name = match tool {
        ToolKind::Bash => "bash",
        ToolKind::Edit => "edit",
        ToolKind::Write => "write",
        ToolKind::Web => "web",
        ToolKind::Other => "other",
    };
    format!(
        "STRATEGY ROTATION ALERT: {tool} tool has failed {count} consecutive times. \
         Stop and reflect: the current approach is not working. \
         Consider: (a) read the related files first to understand the actual state, \
         (b) try a different tool kind, \
         (c) ask the coordinator if the task spec needs revision. \
         Do NOT retry the same approach without changing something.",
        tool = tool_name
    )
}

pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_failure_below_threshold_does_not_trigger() {
        let mut t = StrategyTracker::new(2);
        let r = t.record_failure(ToolKind::Bash, 100);
        assert!(!r.triggered);
        assert_eq!(r.failure_count, 1);
        assert_eq!(r.additional_context, "");
    }

    #[test]
    fn threshold_failure_triggers_with_directive() {
        let mut t = StrategyTracker::new(2);
        t.record_failure(ToolKind::Bash, 100);
        let r = t.record_failure(ToolKind::Bash, 200);
        assert!(r.triggered);
        assert_eq!(r.failure_count, 2);
        assert!(r.additional_context.contains("STRATEGY ROTATION ALERT"));
        assert!(r.additional_context.contains("bash"));
    }

    #[test]
    fn success_resets_only_that_tool() {
        let mut t = StrategyTracker::new(2);
        t.record_failure(ToolKind::Bash, 100);
        t.record_failure(ToolKind::Edit, 100);
        t.record_success(ToolKind::Bash);
        assert_eq!(t.peek(ToolKind::Bash), 0);
        assert_eq!(t.peek(ToolKind::Edit), 1);
    }

    #[test]
    fn peek_does_not_bump_count() {
        let mut t = StrategyTracker::new(2);
        t.record_failure(ToolKind::Bash, 100);
        let before = t.peek(ToolKind::Bash);
        let _ = t.peek(ToolKind::Bash);
        let after = t.peek(ToolKind::Bash);
        assert_eq!(before, after);
    }

    #[test]
    fn other_tool_kind_is_inert() {
        let mut t = StrategyTracker::new(2);
        let r = t.record_failure(ToolKind::Other, 100);
        assert!(!r.triggered);
        // No counter exists for Other, so peek stays 0.
        assert_eq!(t.peek(ToolKind::Other), 0);
    }

    #[test]
    fn threshold_clamped_to_at_least_one() {
        let t = StrategyTracker::new(0);
        let r = t.snapshot();
        // Threshold internal; verify "1 failure trips a threshold of 0"
        // semantics by replaying through a fresh tracker.
        let _ = r;
        let mut t = StrategyTracker::new(0);
        let alert = t.record_failure(ToolKind::Bash, 100);
        assert!(alert.triggered, "threshold 0 must clamp to 1 so first failure trips");
    }

    #[test]
    fn snapshot_restore_roundtrip() {
        let mut t1 = StrategyTracker::new(3);
        t1.record_failure(ToolKind::Bash, 100);
        t1.record_failure(ToolKind::Bash, 200);
        t1.record_failure(ToolKind::Edit, 300);

        let snap = t1.snapshot();
        let t2 = StrategyTracker::from_counts(snap.clone(), 3);
        assert_eq!(t2.peek(ToolKind::Bash), 2);
        assert_eq!(t2.peek(ToolKind::Edit), 1);
        assert_eq!(snap.last_failure_at, 300);
    }

    #[test]
    fn reset_all_clears_every_counter() {
        let mut t = StrategyTracker::new(3);
        t.record_failure(ToolKind::Bash, 100);
        t.record_failure(ToolKind::Edit, 100);
        t.record_failure(ToolKind::Write, 100);
        t.reset_all();
        assert_eq!(t.peek(ToolKind::Bash), 0);
        assert_eq!(t.peek(ToolKind::Edit), 0);
        assert_eq!(t.peek(ToolKind::Write), 0);
    }

    #[test]
    fn failure_counts_json_roundtrip_matches_ts_format() {
        // Ensure the JSON shape stays compatible with the TS sibling.
        let c = FailureCounts {
            bash_failures: 3,
            edit_failures: 1,
            write_failures: 0,
            web_failures: 0,
            last_failure_at: 1700000000,
        };
        let json = serde_json::to_string(&c).expect("serialize");
        assert!(json.contains("\"bash_failures\":3"));
        assert!(json.contains("\"last_failure_at\":1700000000"));
        let back: FailureCounts = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back, c);
    }

    #[test]
    fn record_failure_does_not_wrap_on_overflow() {
        let mut t = StrategyTracker::new(2);
        // Saturating add: even if we somehow looped a huge number of
        // times, the counter must not wrap around to 0 (which would
        // silently disarm the rotation alert).
        for _ in 0..100 {
            t.record_failure(ToolKind::Bash, 0);
        }
        assert_eq!(t.peek(ToolKind::Bash), 100);
    }

    #[test]
    fn version_is_non_empty() {
        assert!(!version().is_empty());
    }
}
