use super::pattern_validator::is_valid_pattern;

#[test]
fn accepts_well_formed_patterns() {
    assert!(is_valid_pattern("Bash(npm test:*)"));
    assert!(is_valid_pattern("WebFetch(domain:github.com)"));
    assert!(is_valid_pattern("Edit(src/**/*.ts)"));
    assert!(is_valid_pattern("Read"));
    assert!(is_valid_pattern("mcp__github__create_issue"));
}

#[test]
fn rejects_garbage_llm_output() {
    assert!(!is_valid_pattern("Bash(const:*)"));
    assert!(!is_valid_pattern("Bash([]:*)"));
    assert!(!is_valid_pattern("Bash(//:*)"));
    assert!(!is_valid_pattern("Bash(```:*)"));
    assert!(!is_valid_pattern("Bash(import:*)"));
    assert!(!is_valid_pattern("Bash(function:*)"));
    assert!(!is_valid_pattern("Bash(class:*)"));
    assert!(!is_valid_pattern("Bash(export:*)"));
    assert!(!is_valid_pattern("Bash(let:*)"));
    assert!(!is_valid_pattern("Bash(var:*)"));
}

#[test]
fn rejects_empty_or_whitespace() {
    assert!(!is_valid_pattern(""));
    assert!(!is_valid_pattern("   "));
    assert!(!is_valid_pattern("\t\n"));
}

#[test]
fn rejects_unknown_shapes() {
    assert!(!is_valid_pattern("RandomTool(thing)"));
    assert!(!is_valid_pattern("notAPattern"));
}
