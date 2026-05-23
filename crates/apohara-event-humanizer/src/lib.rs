//! Dashboard humanizer (symphony #12, G5.G.7).
//!
//! Provider event streams arrive as machine-friendly JSON (`tool_use`,
//! `step_start`, `text`, `usage`, ...). The dashboard renders one
//! human-readable label per event ("Edit > src/foo.ts: +12 / -3").
//! This crate is the canonical map from event → label.
//!
//! Why a crate (not a TS module): the labels are shared by the desktop
//! UI (Rust→ts-rs binding), the TUI dashboard (consumes the JSON
//! directly), and the audit log writer (so log rotation reads the same
//! labels as the live UI). Keeping the rules in one place stops the
//! three surfaces from drifting.
//!
//! Rule precedence
//! ----------------
//! 1. Event `kind` decides the family ("tool_use" / "text" / "usage").
//! 2. Within "tool_use", the `tool` name picks a sub-formatter.
//! 3. Each formatter takes (tool, input) and produces a short label
//!    (under ~80 chars). Anything unrecognized falls back to the
//!    generic "<kind> <tool>" form so the dashboard never goes blank.
//!
//! There is no markup in the label: the UI is responsible for any
//! highlighting / colouring. The humanizer's contract is "one short
//! string per event".

use std::collections::BTreeMap;

/// A minimal projection of a provider event the humanizer needs. We do
/// not bind to the full provider schema — adapters lift their event
/// onto this shape and we render from it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct EventInput {
    /// `tool_use`, `text`, `reasoning`, `step_start`, `step_finish`,
    /// `tool_result`, `usage`, etc.
    pub kind: String,
    /// Tool name when `kind == "tool_use"` / `"tool_result"`, else empty.
    pub tool: String,
    /// Tool input fields the humanizer knows how to format. Adapters
    /// fill the keys that apply (file_path, command, pattern, …).
    pub fields: BTreeMap<String, String>,
}

impl EventInput {
    pub fn new(kind: impl Into<String>) -> Self {
        Self {
            kind: kind.into(),
            tool: String::new(),
            fields: BTreeMap::new(),
        }
    }

    pub fn with_tool(mut self, tool: impl Into<String>) -> Self {
        self.tool = tool.into();
        self
    }

    pub fn with_field(mut self, k: impl Into<String>, v: impl Into<String>) -> Self {
        self.fields.insert(k.into(), v.into());
        self
    }
}

/// Compose a human-readable label for `event`. Always returns a non-empty
/// string (worst case: "<kind>" or "tool: <name>").
pub fn humanize(event: &EventInput) -> String {
    match event.kind.as_str() {
        "tool_use" => humanize_tool_use(event),
        "tool_result" => humanize_tool_result(event),
        "text" => "assistant message".to_string(),
        "reasoning" => "assistant reasoning".to_string(),
        "step_start" => "step start".to_string(),
        "step_finish" => "step finish".to_string(),
        "usage" => humanize_usage(event),
        other if !other.is_empty() => other.to_string(),
        _ => "event".to_string(),
    }
}

fn humanize_tool_use(event: &EventInput) -> String {
    let tool = event.tool.as_str();
    if tool.is_empty() {
        return "tool".to_string();
    }
    match tool {
        // File ops: lead with the path so the eye lands on it.
        "Read" | "Write" | "Edit" | "NotebookRead" | "NotebookEdit" => {
            let path = event.fields.get("file_path").map(String::as_str).unwrap_or("?");
            format!("{tool} {path}")
        }
        "Bash" => {
            let cmd = event
                .fields
                .get("command")
                .map(String::as_str)
                .unwrap_or("?");
            // Truncate long commands so the dashboard line stays tidy.
            let trimmed = truncate_to(cmd, 60);
            format!("Bash $ {trimmed}")
        }
        "Grep" => {
            let pat = event
                .fields
                .get("pattern")
                .map(String::as_str)
                .unwrap_or("?");
            format!("Grep /{pat}/")
        }
        "Glob" => {
            let pat = event
                .fields
                .get("pattern")
                .map(String::as_str)
                .unwrap_or("?");
            format!("Glob {pat}")
        }
        "WebFetch" => {
            let url = event.fields.get("url").map(String::as_str).unwrap_or("?");
            format!("WebFetch {}", truncate_to(url, 60))
        }
        "WebSearch" => {
            let q = event.fields.get("query").map(String::as_str).unwrap_or("?");
            format!("WebSearch \"{}\"", truncate_to(q, 60))
        }
        other => format!("tool: {other}"),
    }
}

fn humanize_tool_result(event: &EventInput) -> String {
    let tool = if event.tool.is_empty() { "?" } else { event.tool.as_str() };
    if let Some(err) = event.fields.get("error") {
        return format!("{tool} ERROR: {}", truncate_to(err, 60));
    }
    if let Some(plus) = event.fields.get("lines_added") {
        if let Some(minus) = event.fields.get("lines_removed") {
            return format!("{tool} +{plus} / -{minus}");
        }
    }
    if let Some(bytes) = event.fields.get("bytes") {
        return format!("{tool} {bytes} bytes");
    }
    format!("{tool} ok")
}

fn humanize_usage(event: &EventInput) -> String {
    let input = event.fields.get("input").map(String::as_str).unwrap_or("0");
    let output = event.fields.get("output").map(String::as_str).unwrap_or("0");
    format!("tokens: in={input} out={output}")
}

/// Truncate `s` to at most `max` chars, appending an ellipsis when cut.
/// Operates on chars (not bytes) so multi-byte UTF-8 boundaries are safe.
fn truncate_to(s: &str, max: usize) -> String {
    let count = s.chars().count();
    if count <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}

pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

// ---------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(kind: &str) -> EventInput {
        EventInput::new(kind)
    }

    #[test]
    fn humanize_read_uses_path() {
        let e = ev("tool_use")
            .with_tool("Read")
            .with_field("file_path", "/x/y.ts");
        assert_eq!(humanize(&e), "Read /x/y.ts");
    }

    #[test]
    fn humanize_edit_uses_path() {
        let e = ev("tool_use")
            .with_tool("Edit")
            .with_field("file_path", "/src/foo.rs");
        assert_eq!(humanize(&e), "Edit /src/foo.rs");
    }

    #[test]
    fn humanize_bash_truncates_long_commands() {
        let long = "x".repeat(200);
        let e = ev("tool_use")
            .with_tool("Bash")
            .with_field("command", &long);
        let label = humanize(&e);
        assert!(label.starts_with("Bash $ "));
        // 60 chars cap + "…" + prefix "Bash $ " (7 chars).
        assert!(label.chars().count() <= 7 + 60);
        assert!(label.ends_with('…'));
    }

    #[test]
    fn humanize_bash_short_passes_through() {
        let e = ev("tool_use")
            .with_tool("Bash")
            .with_field("command", "ls -la");
        assert_eq!(humanize(&e), "Bash $ ls -la");
    }

    #[test]
    fn humanize_grep_includes_pattern() {
        let e = ev("tool_use")
            .with_tool("Grep")
            .with_field("pattern", "TODO");
        assert_eq!(humanize(&e), "Grep /TODO/");
    }

    #[test]
    fn humanize_glob_includes_pattern() {
        let e = ev("tool_use")
            .with_tool("Glob")
            .with_field("pattern", "**/*.ts");
        assert_eq!(humanize(&e), "Glob **/*.ts");
    }

    #[test]
    fn humanize_unknown_tool_falls_back_gracefully() {
        let e = ev("tool_use").with_tool("MysteryTool");
        assert_eq!(humanize(&e), "tool: MysteryTool");
    }

    #[test]
    fn humanize_tool_use_without_tool_is_safe() {
        let e = ev("tool_use");
        assert_eq!(humanize(&e), "tool");
    }

    #[test]
    fn humanize_text_event() {
        assert_eq!(humanize(&ev("text")), "assistant message");
    }

    #[test]
    fn humanize_reasoning_event() {
        assert_eq!(humanize(&ev("reasoning")), "assistant reasoning");
    }

    #[test]
    fn humanize_usage_event() {
        let e = ev("usage")
            .with_field("input", "1024")
            .with_field("output", "256");
        assert_eq!(humanize(&e), "tokens: in=1024 out=256");
    }

    #[test]
    fn humanize_unknown_kind_returns_kind_string() {
        assert_eq!(humanize(&ev("custom-kind")), "custom-kind");
    }

    #[test]
    fn humanize_empty_event_returns_generic_label() {
        // Default has empty kind — must still produce SOMETHING.
        let label = humanize(&EventInput::default());
        assert!(!label.is_empty());
    }

    #[test]
    fn humanize_tool_result_with_error_includes_message() {
        let e = ev("tool_result")
            .with_tool("Edit")
            .with_field("error", "file not found");
        assert_eq!(humanize(&e), "Edit ERROR: file not found");
    }

    #[test]
    fn humanize_tool_result_with_diff_uses_plus_minus() {
        let e = ev("tool_result")
            .with_tool("Edit")
            .with_field("lines_added", "12")
            .with_field("lines_removed", "3");
        assert_eq!(humanize(&e), "Edit +12 / -3");
    }

    #[test]
    fn humanize_webfetch_truncates_long_urls() {
        let url = format!("https://example.com/{}", "a".repeat(200));
        let e = ev("tool_use")
            .with_tool("WebFetch")
            .with_field("url", &url);
        let label = humanize(&e);
        assert!(label.starts_with("WebFetch "));
        assert!(label.ends_with('…'));
    }

    #[test]
    fn truncate_handles_multibyte_chars_safely() {
        // Each "café" is 4 chars (5 bytes) — cutting on byte boundary
        // would corrupt the UTF-8. truncate_to operates on chars.
        let input = "café café café";
        let label = truncate_to(input, 5);
        assert!(label.chars().count() == 5);
    }

    #[test]
    fn version_is_non_empty() {
        assert!(!version().is_empty());
    }
}
