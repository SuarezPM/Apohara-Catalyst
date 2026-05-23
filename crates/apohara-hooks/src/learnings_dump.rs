//! Learnings dump.
//!
//! Mirrors `src/core/hooks/learnings-dump.ts` (G5.C.5).
//!
//! At session-end the agent surfaces a structured summary of what it
//! learned: discoveries, decisions, incidents, conventions, next steps.
//! The dump is written atomically (§0.8) so the next session can read
//! it on startup and inject it as `additionalContext`. Also exposes an
//! in-memory `render_additional_context()` for callers that prefer to
//! pass the envelope directly without a roundtrip through disk.

use chrono::TimeZone;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LearningCategory {
    Discoveries,
    Decisions,
    Incidents,
    Conventions,
    NextSteps,
}

impl LearningCategory {
    fn header(self) -> &'static str {
        match self {
            LearningCategory::Discoveries => "Discoveries",
            LearningCategory::Decisions => "Decisions",
            LearningCategory::Incidents => "Incidents",
            LearningCategory::Conventions => "Conventions",
            LearningCategory::NextSteps => "Next steps",
        }
    }

    fn order() -> [LearningCategory; 5] {
        [
            LearningCategory::Discoveries,
            LearningCategory::Decisions,
            LearningCategory::Incidents,
            LearningCategory::Conventions,
            LearningCategory::NextSteps,
        ]
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LearningEntry {
    pub category: LearningCategory,
    pub title: String,
    pub detail: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LearningsSnapshot {
    pub discoveries: Vec<LearningEntry>,
    pub decisions: Vec<LearningEntry>,
    pub incidents: Vec<LearningEntry>,
    pub conventions: Vec<LearningEntry>,
    pub next_steps: Vec<LearningEntry>,
}

impl LearningsSnapshot {
    fn list(&self, cat: LearningCategory) -> &[LearningEntry] {
        match cat {
            LearningCategory::Discoveries => &self.discoveries,
            LearningCategory::Decisions => &self.decisions,
            LearningCategory::Incidents => &self.incidents,
            LearningCategory::Conventions => &self.conventions,
            LearningCategory::NextSteps => &self.next_steps,
        }
    }

    fn list_mut(&mut self, cat: LearningCategory) -> &mut Vec<LearningEntry> {
        match cat {
            LearningCategory::Discoveries => &mut self.discoveries,
            LearningCategory::Decisions => &mut self.decisions,
            LearningCategory::Incidents => &mut self.incidents,
            LearningCategory::Conventions => &mut self.conventions,
            LearningCategory::NextSteps => &mut self.next_steps,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DumpOptions {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub dir: PathBuf,
    #[serde(rename = "finishedAt")]
    pub finished_at: i64,
    pub objective: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum LearningsHookEvent {
    SessionStop {
        #[serde(rename = "sessionId")]
        session_id: String,
        reason: super::events::StopReason,
        timestamp: i64,
    },
    SessionLearning {
        category: LearningCategory,
        title: String,
        detail: String,
        timestamp: i64,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum LearningsHookOutcome {
    Recorded,
    Ignored,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RenderedAdditionalContext {
    #[serde(rename = "additionalContext")]
    pub additional_context: String,
}

/// Per-session learnings collector. Thread-safe internal state so the
/// hooks dispatcher can share an instance across async tasks. Owners
/// don't share collectors across sessions — one instance per run.
#[derive(Debug, Default)]
pub struct LearningsCollector {
    entries: Mutex<LearningsSnapshot>,
}

impl LearningsCollector {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add(&self, entry: LearningEntry) {
        let mut guard = self.entries.lock().expect("learnings lock poisoned");
        guard.list_mut(entry.category).push(entry);
    }

    /// Shallow clone of the current snapshot — callers receive owned data
    /// so they cannot mutate our buffer.
    pub fn snapshot(&self) -> LearningsSnapshot {
        let guard = self.entries.lock().expect("learnings lock poisoned");
        guard.clone()
    }

    /// Dump the snapshot to `<dir>/learnings-<sessionId>.json` atomically
    /// (temp file in the same dir + rename). Returns the final path.
    pub fn dump(&self, opts: &DumpOptions) -> std::io::Result<PathBuf> {
        std::fs::create_dir_all(&opts.dir)?;
        let snapshot = self.snapshot();
        // Use an ordered map so the serialized output is deterministic and
        // matches the TS shape (`sessionId`, `objective`, `finishedAt`,
        // `learnings`).
        let mut body: BTreeMap<&str, serde_json::Value> = BTreeMap::new();
        body.insert("sessionId", serde_json::json!(opts.session_id));
        body.insert("objective", serde_json::json!(opts.objective));
        body.insert("finishedAt", serde_json::json!(opts.finished_at));
        body.insert("learnings", serde_json::to_value(&snapshot)?);
        let bytes = serde_json::to_vec(&body)?;

        let final_path = opts.dir.join(format!("learnings-{}.json", opts.session_id));
        atomic_write(&final_path, &bytes)?;
        Ok(final_path)
    }

    pub fn render_additional_context(&self) -> RenderedAdditionalContext {
        let guard = self.entries.lock().expect("learnings lock poisoned");
        let mut lines: Vec<String> = Vec::new();
        let mut any = false;
        for cat in LearningCategory::order() {
            let list = guard.list(cat);
            if list.is_empty() {
                continue;
            }
            any = true;
            lines.push(format!("### {}", cat.header()));
            for e in list {
                lines.push(format!("- {}: {}", e.title, e.detail));
            }
            lines.push(String::new());
        }
        let body = if any {
            lines.join("\n").trim_end().to_string()
        } else {
            String::new()
        };
        RenderedAdditionalContext {
            additional_context: body,
        }
    }

    pub fn on_hook_event(&self, event: LearningsHookEvent) -> LearningsHookOutcome {
        match event {
            LearningsHookEvent::SessionStop {
                reason, timestamp, ..
            } => {
                let iso = chrono::Utc
                    .timestamp_millis_opt(timestamp)
                    .single()
                    .map(|dt| dt.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
                    .unwrap_or_else(|| timestamp.to_string());
                let reason_label = match reason {
                    super::events::StopReason::Completed => "completed",
                    super::events::StopReason::Interrupted => "interrupted",
                    super::events::StopReason::Crashed => "crashed",
                };
                self.add(LearningEntry {
                    category: LearningCategory::NextSteps,
                    title: format!("session ended ({reason_label})"),
                    detail: format!("at {iso}"),
                });
                LearningsHookOutcome::Recorded
            }
            LearningsHookEvent::SessionLearning {
                category,
                title,
                detail,
                ..
            } => {
                self.add(LearningEntry {
                    category,
                    title,
                    detail,
                });
                LearningsHookOutcome::Recorded
            }
        }
    }
}

/// Atomic write per §0.8: write a sibling temp file, fsync, rename. Same
/// directory so the rename is atomic on POSIX. Leaves no `.tmp.*` leftover
/// when the rename succeeds.
fn atomic_write(final_path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let dir = final_path.parent().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "final_path must have a parent",
        )
    })?;
    let mut tmp = tempfile::NamedTempFile::new_in(dir)?;
    tmp.write_all(bytes)?;
    tmp.as_file_mut().sync_all()?;
    tmp.persist(final_path)
        .map_err(|e| std::io::Error::other(e.error))?;
    Ok(())
}
