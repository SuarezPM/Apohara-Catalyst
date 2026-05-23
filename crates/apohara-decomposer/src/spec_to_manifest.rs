//! Deterministic SPEC.md → tasks manifest extractor.
//!
//! Scans markdown headings of the form:
//!   `## Task <id>: <description>`
//!   `### Task <id>: <description>`
//!   `### Step <id>: <description>` (treated identically)
//!
//! Each heading produces one [`RawTask`] with empty symbols/depends_on.
//! Subsequent `- depends: <id1>, <id2>` lines under a task fill its
//! `dependsOn`. `- role: <agent_role>` lines override the default
//! (`coder`). Symbol manifests are NOT auto-extracted — they remain
//! empty here and are filled in by upstream tooling (or by the agent
//! itself once the task is dispatched). This matches the TS
//! `manifests.ts` shape: this crate validates / produces manifests, it
//! does not infer them from prose.
//!
//! The parser is intentionally simple and deterministic — no LLM, no
//! tree-sitter. It is the Rust equivalent of "give me a parseable
//! skeleton from a SPEC.md so the orchestrator has something to chew on"
//! and lets the desktop UI render a task graph in O(lines) time.

use crate::manifests::{AgentRole, RawTask, TaskSymbolManifest};

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct DecomposedManifest {
    pub tasks: Vec<RawTask>,
}

fn parse_agent_role(s: &str) -> AgentRole {
    match s.trim().to_lowercase().as_str() {
        "planner" => AgentRole::Planner,
        "critic" => AgentRole::Critic,
        "judge" => AgentRole::Judge,
        "explorer" => AgentRole::Explorer,
        "editor" => AgentRole::Editor,
        _ => AgentRole::Coder,
    }
}

/// Strip leading `#` and whitespace from a markdown heading line.
fn strip_heading(line: &str) -> Option<&str> {
    let trimmed = line.trim_start();
    if !trimmed.starts_with('#') {
        return None;
    }
    Some(trimmed.trim_start_matches('#').trim_start())
}

/// Try to match `Task <id>: <desc>` or `Step <id>: <desc>` inside a
/// heading body. Returns `(id, description)` on match.
fn match_task_heading(body: &str) -> Option<(String, String)> {
    let lower = body.to_ascii_lowercase();
    let stripped = if let Some(rest) = lower.strip_prefix("task ") {
        &body[5..body.len() - (lower.len() - 5 - rest.len())]
    } else if let Some(rest) = lower.strip_prefix("step ") {
        &body[5..body.len() - (lower.len() - 5 - rest.len())]
    } else {
        return None;
    };
    let (id, desc) = stripped.split_once(':')?;
    let id = id.trim();
    let desc = desc.trim();
    if id.is_empty() || desc.is_empty() {
        return None;
    }
    Some((id.to_string(), desc.to_string()))
}

/// Parse a SPEC.md body into a [`DecomposedManifest`]. Pure / cheap /
/// deterministic — safe to call on the Tauri main thread.
pub fn decompose_spec(spec: &str) -> DecomposedManifest {
    let mut tasks: Vec<RawTask> = Vec::new();
    for raw_line in spec.lines() {
        if let Some(body) = strip_heading(raw_line) {
            if let Some((id, desc)) = match_task_heading(body) {
                tasks.push(RawTask {
                    id,
                    description: desc,
                    depends_on: Vec::new(),
                    agent_role: AgentRole::Coder,
                    symbols: TaskSymbolManifest::default(),
                });
                continue;
            }
        }
        let trimmed = raw_line.trim_start();
        let Some(current) = tasks.last_mut() else {
            continue;
        };
        if let Some(rest) = trimmed
            .strip_prefix("- depends:")
            .or_else(|| trimmed.strip_prefix("* depends:"))
        {
            current.depends_on = rest
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
        } else if let Some(rest) = trimmed
            .strip_prefix("- role:")
            .or_else(|| trimmed.strip_prefix("* role:"))
        {
            current.agent_role = parse_agent_role(rest);
        }
    }
    DecomposedManifest { tasks }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_spec_yields_zero_tasks() {
        let m = decompose_spec("");
        assert!(m.tasks.is_empty());
    }

    #[test]
    fn spec_without_task_headings_yields_zero_tasks() {
        let m = decompose_spec("# Overview\n\nSome prose.\n## Background\nMore.\n");
        assert!(m.tasks.is_empty());
    }

    #[test]
    fn single_task_heading_extracted() {
        let m = decompose_spec("## Task t1: build the thing\n");
        assert_eq!(m.tasks.len(), 1);
        assert_eq!(m.tasks[0].id, "t1");
        assert_eq!(m.tasks[0].description, "build the thing");
        assert_eq!(m.tasks[0].agent_role, AgentRole::Coder);
        assert!(m.tasks[0].depends_on.is_empty());
    }

    #[test]
    fn step_heading_also_recognized() {
        let m = decompose_spec("### Step s1: write tests\n");
        assert_eq!(m.tasks.len(), 1);
        assert_eq!(m.tasks[0].id, "s1");
    }

    #[test]
    fn depends_bullet_attaches_to_previous_task() {
        let spec = "## Task a: first\n## Task b: second\n- depends: a\n";
        let m = decompose_spec(spec);
        assert_eq!(m.tasks.len(), 2);
        assert_eq!(m.tasks[0].depends_on, Vec::<String>::new());
        assert_eq!(m.tasks[1].depends_on, vec!["a".to_string()]);
    }

    #[test]
    fn depends_multi_comma_separated() {
        let spec = "## Task c: third\n- depends: a , b ,\n";
        let m = decompose_spec(spec);
        assert_eq!(m.tasks[0].depends_on, vec!["a".to_string(), "b".to_string()]);
    }

    #[test]
    fn role_bullet_overrides_default() {
        let spec = "## Task r: review\n- role: critic\n";
        let m = decompose_spec(spec);
        assert_eq!(m.tasks[0].agent_role, AgentRole::Critic);
    }

    #[test]
    fn unknown_role_falls_back_to_coder() {
        let spec = "## Task r: review\n- role: wizard\n";
        let m = decompose_spec(spec);
        assert_eq!(m.tasks[0].agent_role, AgentRole::Coder);
    }

    #[test]
    fn bullets_before_first_task_are_ignored() {
        let spec = "- depends: nothing\n- role: critic\n## Task a: x\n";
        let m = decompose_spec(spec);
        assert_eq!(m.tasks.len(), 1);
        assert!(m.tasks[0].depends_on.is_empty());
        assert_eq!(m.tasks[0].agent_role, AgentRole::Coder);
    }

    #[test]
    fn heading_with_no_colon_is_skipped() {
        let m = decompose_spec("## Task malformed\n");
        assert!(m.tasks.is_empty());
    }

    #[test]
    fn star_bullets_also_parsed() {
        let spec = "## Task x: y\n* depends: a\n* role: judge\n";
        let m = decompose_spec(spec);
        assert_eq!(m.tasks[0].depends_on, vec!["a".to_string()]);
        assert_eq!(m.tasks[0].agent_role, AgentRole::Judge);
    }

    #[test]
    fn case_insensitive_task_keyword() {
        let m = decompose_spec("## TASK upper: do it\n");
        assert_eq!(m.tasks.len(), 1);
        assert_eq!(m.tasks[0].id, "upper");
    }

    #[test]
    fn many_tasks_preserves_order() {
        let spec = "## Task a: one\n## Task b: two\n## Task c: three\n";
        let m = decompose_spec(spec);
        assert_eq!(m.tasks.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(), vec!["a", "b", "c"]);
    }

    #[test]
    fn manifest_serializes_camel_case() {
        let m = decompose_spec("## Task a: do\n- depends: b\n- role: planner\n");
        let json = serde_json::to_string(&m).unwrap();
        assert!(json.contains("\"dependsOn\""), "json: {json}");
        assert!(json.contains("\"agentRole\""));
        assert!(json.contains("\"planner\""));
    }
}
