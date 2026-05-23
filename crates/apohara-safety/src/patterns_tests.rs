use super::patterns::{match_pattern, parse_pattern_string, PermissionPattern, ToolInvocation};
use serde_json::json;

fn bash(cmd: &str) -> ToolInvocation {
    ToolInvocation::new("Bash").with_input("command", json!(cmd))
}

fn webfetch(url: &str) -> ToolInvocation {
    ToolInvocation::new("WebFetch").with_input("url", json!(url))
}

fn edit(file: &str) -> ToolInvocation {
    ToolInvocation::new("Edit").with_input("file_path", json!(file))
}

#[test]
fn parse_bash_prefix() {
    assert_eq!(
        parse_pattern_string("Bash(npm test:*)"),
        Some(PermissionPattern::BashPrefix {
            prefix: "npm test".to_string()
        })
    );
}

#[test]
fn parse_webfetch_domain() {
    assert_eq!(
        parse_pattern_string("WebFetch(domain:github.com)"),
        Some(PermissionPattern::WebFetchDomain {
            domain: "github.com".to_string()
        })
    );
}

#[test]
fn parse_edit_glob() {
    assert_eq!(
        parse_pattern_string("Edit(src/**/*.ts)"),
        Some(PermissionPattern::EditGlob {
            glob: "src/**/*.ts".to_string()
        })
    );
}

#[test]
fn parse_mcp_prefix() {
    assert_eq!(
        parse_pattern_string("mcp__github__*"),
        Some(PermissionPattern::McpPrefix {
            prefix: "mcp__github__".to_string()
        })
    );
}

#[test]
fn parse_returns_none_for_garbage() {
    assert!(parse_pattern_string("not a pattern").is_none());
    assert!(parse_pattern_string("Bash(no-suffix)").is_none());
}

#[test]
fn bash_prefix_matches_starts_with() {
    let p = PermissionPattern::BashPrefix {
        prefix: "npm test".to_string(),
    };
    assert!(match_pattern(&p, &bash("npm test -- --silent")));
    assert!(match_pattern(&p, &bash("npm testing")));
    assert!(!match_pattern(&p, &bash("yarn test")));
    assert!(!match_pattern(
        &p,
        &ToolInvocation::new("Edit").with_input("file_path", json!("npm test"))
    ));
}

#[test]
fn webfetch_domain_matches_exact_and_subdomain() {
    let p = PermissionPattern::WebFetchDomain {
        domain: "github.com".to_string(),
    };
    assert!(match_pattern(&p, &webfetch("https://github.com/foo")));
    assert!(match_pattern(
        &p,
        &webfetch("https://api.github.com/foo")
    ));
    assert!(!match_pattern(&p, &webfetch("https://evil.com/foo")));
    // suffix-only match must not pass for nytimes -> imes.com style traps.
    let evil = PermissionPattern::WebFetchDomain {
        domain: "imes.com".to_string(),
    };
    assert!(!match_pattern(&evil, &webfetch("https://nytimes.com/foo")));
}

#[test]
fn edit_glob_matches_normalized_path() {
    let p = PermissionPattern::EditGlob {
        glob: "src/**/*.ts".to_string(),
    };
    assert!(match_pattern(&p, &edit("src/api/users.ts")));
    assert!(!match_pattern(&p, &edit("docs/readme.md")));
}

#[test]
fn edit_glob_rejects_dotdot_escape() {
    // Pattern allows subdir/**; raw `subdir/../../etc/passwd` must NOT
    // match because we normalize the path before matching.
    let p = PermissionPattern::EditGlob {
        glob: "subdir/**".to_string(),
    };
    assert!(!match_pattern(&p, &edit("subdir/../../etc/passwd")));
    assert!(match_pattern(&p, &edit("subdir/safe.txt")));
}

#[test]
fn mcp_prefix_matches_tool_name() {
    let p = PermissionPattern::McpPrefix {
        prefix: "mcp__github__".to_string(),
    };
    assert!(match_pattern(
        &p,
        &ToolInvocation::new("mcp__github__create_issue")
    ));
    assert!(!match_pattern(
        &p,
        &ToolInvocation::new("mcp__gitlab__create_issue")
    ));
}

#[test]
fn serde_roundtrip_pattern() {
    let p = PermissionPattern::BashPrefix {
        prefix: "git status".to_string(),
    };
    let json_s = serde_json::to_string(&p).unwrap();
    let back: PermissionPattern = serde_json::from_str(&json_s).unwrap();
    assert_eq!(p, back);
}
