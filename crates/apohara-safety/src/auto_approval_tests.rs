use super::auto_approval::{classify_tool_for_auto_approval, AutoApprovalDecision};
use super::patterns::ToolInvocation;
use serde_json::json;

fn bash(cmd: &str) -> ToolInvocation {
    ToolInvocation::new("Bash").with_input("command", json!(cmd))
}

#[test]
fn read_only_tools_auto_allow() {
    for tool in ["Read", "Glob", "Grep", "LS", "NotebookRead"] {
        let d = classify_tool_for_auto_approval(&ToolInvocation::new(tool));
        assert!(matches!(d, AutoApprovalDecision::Allow { .. }), "{tool}");
    }
}

#[test]
fn safe_bash_commands_auto_allow() {
    let d = classify_tool_for_auto_approval(&bash("ls -la"));
    assert!(d.is_allow());
}

#[test]
fn unsafe_bash_commands_prompt() {
    let d = classify_tool_for_auto_approval(&bash("rm -rf /tmp/x"));
    matches!(d, AutoApprovalDecision::Prompt { .. });
    assert!(!d.is_allow());
}

#[test]
fn git_status_auto_allow() {
    let d = classify_tool_for_auto_approval(&bash("git status"));
    assert!(d.is_allow());
}

#[test]
fn git_commit_prompts() {
    let d = classify_tool_for_auto_approval(&bash("git commit -m wip"));
    assert!(!d.is_allow());
}

#[test]
fn empty_bash_prompts() {
    let d = classify_tool_for_auto_approval(&bash(""));
    assert!(!d.is_allow());
}

/// Compound bash NEVER auto-approves even if every leg is in the safe
/// list. Allow would short-circuit the scope-clamp in permission_service.
#[test]
fn compound_bash_never_auto_approves_even_when_all_safe() {
    let d = classify_tool_for_auto_approval(&bash("ls && pwd"));
    assert!(
        !d.is_allow(),
        "ls && pwd auto-approved despite INV-bash-scope clamp: {d:?}"
    );
    let d2 = classify_tool_for_auto_approval(&bash("git status; ls"));
    assert!(!d2.is_allow());
}

#[test]
fn unknown_tool_prompts() {
    let d = classify_tool_for_auto_approval(&ToolInvocation::new("Edit"));
    assert!(!d.is_allow());
}
