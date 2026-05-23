//! Plan document parser (port of `src/core/spec/planDocuments.ts`).
//!
//! Reads a markdown file with YAML frontmatter (delimited by `---`) and
//! section headings (`## Objective`, `## Acceptance Criteria`, ...).
//!
//! Schema (frontmatter):
//!   - title: required string
//!   - status: required enum (draft | active | paused | done)
//!   - planType: optional enum (feature | bug | refactor | research)
//!   - priority: optional enum (urgent | high | normal | low)
//!   - owner, stakeholders, tags, created, updated, progress: optional
//!
//! Body sections: Objective (required), Acceptance Criteria, Out of Scope,
//! Context.
//!
//! `planId = sha1(filepath + frontmatter.title)` — deterministic for
//! cache keys (matches TS).

use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use std::collections::HashMap;
use std::path::Path;
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PlanStatus {
    Draft,
    Active,
    Paused,
    Done,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PlanType {
    Feature,
    Bug,
    Refactor,
    Research,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PlanPriority {
    Urgent,
    High,
    Normal,
    Low,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentSessionOutcome {
    Success,
    Failure,
    InProgress,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionRef {
    pub session_id: String,
    pub started_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outcome: Option<AgentSessionOutcome>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChecklistItem {
    pub checked: bool,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanDocument {
    pub plan_id: String,
    pub title: String,
    pub status: PlanStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan_type: Option<PlanType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<PlanPriority>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stakeholders: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<f64>,
    pub agent_sessions: Vec<AgentSessionRef>,
    pub objective: String,
    pub acceptance_criteria: Vec<ChecklistItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub out_of_scope: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<String>,
}

#[derive(Debug, Error)]
pub enum PlanParseError {
    #[error("io error reading {path}: {source}")]
    Io {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("plan {0} missing YAML frontmatter (must start with ---)")]
    MissingFrontmatter(String),
    #[error("plan {0} missing closing --- for frontmatter")]
    UnclosedFrontmatter(String),
    #[error("plan {path} has malformed YAML frontmatter: {source}")]
    YamlParse {
        path: String,
        #[source]
        source: serde_yaml::Error,
    },
    #[error("plan {path} missing required field: {field}")]
    MissingField { path: String, field: &'static str },
    #[error("plan {path} {field} must be one of {allowed}, got: {got}")]
    InvalidEnum {
        path: String,
        field: &'static str,
        allowed: String,
        got: String,
    },
    #[error("plan {path} missing required section: ## {section}")]
    MissingSection {
        path: String,
        section: &'static str,
    },
}

/// Parse a plan document from disk. Async to mirror the TS API and to
/// stay non-blocking when called from inside the watcher thread.
pub async fn parse_plan_document(filepath: &Path) -> Result<PlanDocument, PlanParseError> {
    let raw = tokio::fs::read_to_string(filepath)
        .await
        .map_err(|e| PlanParseError::Io {
            path: filepath.display().to_string(),
            source: e,
        })?;
    parse_plan_document_str(filepath, &raw)
}

/// Pure (sync, no IO) parse so unit tests stay fast and the cache layer
/// can reuse a single read.
pub fn parse_plan_document_str(
    filepath: &Path,
    raw: &str,
) -> Result<PlanDocument, PlanParseError> {
    let path_str = filepath.display().to_string();

    if !raw.starts_with("---\n") {
        return Err(PlanParseError::MissingFrontmatter(path_str));
    }
    let closing_idx = raw[4..]
        .find("\n---\n")
        .map(|i| i + 4)
        .ok_or_else(|| PlanParseError::UnclosedFrontmatter(path_str.clone()))?;
    let fm_raw = &raw[4..closing_idx];
    let body = &raw[closing_idx + 5..];

    let fm: HashMap<String, serde_yaml::Value> = if fm_raw.trim().is_empty() {
        HashMap::new()
    } else {
        serde_yaml::from_str(fm_raw).map_err(|e| PlanParseError::YamlParse {
            path: path_str.clone(),
            source: e,
        })?
    };

    // title (required)
    let title = match fm.get("title") {
        Some(serde_yaml::Value::String(s)) if !s.trim().is_empty() => s.trim().to_string(),
        _ => {
            return Err(PlanParseError::MissingField {
                path: path_str,
                field: "title",
            })
        }
    };

    // status (required enum)
    let status_raw = fm.get("status").and_then(|v| v.as_str()).unwrap_or("");
    let status = parse_status(status_raw).ok_or_else(|| PlanParseError::InvalidEnum {
        path: path_str.clone(),
        field: "status",
        allowed: "draft|active|paused|done".to_string(),
        got: status_raw.to_string(),
    })?;

    let plan_type = optional_enum(
        fm.get("planType"),
        parse_plan_type,
        "planType",
        "feature|bug|refactor|research",
        &path_str,
    )?;
    let priority = optional_enum(
        fm.get("priority"),
        parse_priority,
        "priority",
        "urgent|high|normal|low",
        &path_str,
    )?;

    // Body sections.
    let sections = split_sections(body);
    let objective = sections
        .get("Objective")
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    if objective.is_empty() {
        return Err(PlanParseError::MissingSection {
            path: path_str,
            section: "Objective",
        });
    }
    let acceptance_criteria =
        parse_checklist(sections.get("Acceptance Criteria").map_or("", |s| s.as_str()));
    let out_of_scope = parse_bullet_list(sections.get("Out of Scope").map_or("", |s| s.as_str()));
    let context_section = sections
        .get("Context")
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let plan_id = {
        let mut h = Sha1::new();
        h.update(path_str.as_bytes());
        h.update(title.as_bytes());
        hex::encode(h.finalize())
    };

    Ok(PlanDocument {
        plan_id,
        title,
        status,
        plan_type,
        priority,
        owner: fm
            .get("owner")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        stakeholders: extract_string_array(fm.get("stakeholders")),
        tags: extract_string_array(fm.get("tags")),
        created: fm
            .get("created")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        updated: fm
            .get("updated")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        progress: fm.get("progress").and_then(|v| v.as_f64()),
        agent_sessions: Vec::new(),
        objective,
        acceptance_criteria,
        out_of_scope: if out_of_scope.is_empty() {
            None
        } else {
            Some(out_of_scope)
        },
        context: context_section,
    })
}

fn parse_status(s: &str) -> Option<PlanStatus> {
    match s {
        "draft" => Some(PlanStatus::Draft),
        "active" => Some(PlanStatus::Active),
        "paused" => Some(PlanStatus::Paused),
        "done" => Some(PlanStatus::Done),
        _ => None,
    }
}

fn parse_plan_type(s: &str) -> Option<PlanType> {
    match s {
        "feature" => Some(PlanType::Feature),
        "bug" => Some(PlanType::Bug),
        "refactor" => Some(PlanType::Refactor),
        "research" => Some(PlanType::Research),
        _ => None,
    }
}

fn parse_priority(s: &str) -> Option<PlanPriority> {
    match s {
        "urgent" => Some(PlanPriority::Urgent),
        "high" => Some(PlanPriority::High),
        "normal" => Some(PlanPriority::Normal),
        "low" => Some(PlanPriority::Low),
        _ => None,
    }
}

fn optional_enum<T, F>(
    value: Option<&serde_yaml::Value>,
    parser: F,
    field: &'static str,
    allowed: &str,
    path: &str,
) -> Result<Option<T>, PlanParseError>
where
    F: Fn(&str) -> Option<T>,
{
    match value {
        None | Some(serde_yaml::Value::Null) => Ok(None),
        Some(serde_yaml::Value::String(s)) => match parser(s) {
            Some(parsed) => Ok(Some(parsed)),
            None => Err(PlanParseError::InvalidEnum {
                path: path.to_string(),
                field,
                allowed: allowed.to_string(),
                got: s.clone(),
            }),
        },
        Some(other) => Err(PlanParseError::InvalidEnum {
            path: path.to_string(),
            field,
            allowed: allowed.to_string(),
            got: format!("{other:?}"),
        }),
    }
}

fn extract_string_array(value: Option<&serde_yaml::Value>) -> Option<Vec<String>> {
    let seq = value.and_then(|v| v.as_sequence())?;
    let strs: Vec<String> = seq
        .iter()
        .filter_map(|v| v.as_str().map(|s| s.to_string()))
        .collect();
    if strs.is_empty() {
        None
    } else {
        Some(strs)
    }
}

fn split_sections(body: &str) -> HashMap<String, String> {
    let mut out: HashMap<String, String> = HashMap::new();
    let mut current_heading: Option<String> = None;
    let mut current_buffer: Vec<&str> = Vec::new();

    for line in body.split('\n') {
        let trimmed = line.trim_end_matches('\r');
        if let Some(rest) = trimmed.strip_prefix("## ") {
            if let Some(h) = current_heading.take() {
                out.insert(h, current_buffer.join("\n"));
            }
            current_heading = Some(rest.trim().to_string());
            current_buffer = Vec::new();
        } else if current_heading.is_some() {
            current_buffer.push(line);
        }
    }
    if let Some(h) = current_heading {
        out.insert(h, current_buffer.join("\n"));
    }
    out
}

fn parse_checklist(body: &str) -> Vec<ChecklistItem> {
    let re = regex::Regex::new(r"^\s*-\s*\[([ xX])\]\s+(.+?)\s*$").unwrap();
    body.split('\n')
        .filter_map(|line| {
            re.captures(line.trim_end_matches('\r')).map(|caps| ChecklistItem {
                checked: caps[1].eq_ignore_ascii_case("x"),
                text: caps[2].trim().to_string(),
            })
        })
        .collect()
}

fn parse_bullet_list(body: &str) -> Vec<String> {
    let re = regex::Regex::new(r"^\s*-\s+(.+?)\s*$").unwrap();
    body.split('\n')
        .filter_map(|line| {
            re.captures(line.trim_end_matches('\r'))
                .map(|caps| caps[1].trim().to_string())
        })
        .collect()
}
