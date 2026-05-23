//! Declarative reaction config parser (G6.D.8).
//!
//! `reactions.conf` is a TOML-style file mapping trigger events to
//! action chains. Example:
//!
//! ```toml
//! [on.issue_opened]
//! action_chain = ["triage", "route"]
//!
//! [on.review_requested]
//! action_chain = ["assign_reviewer"]
//! ```
//!
//! We DO NOT pull a full TOML crate dependency for this — the syntax
//! we accept is intentionally a tiny subset and the parser stays small
//! and dependency-free. The format is line-oriented:
//!   - `# ...`             comments (ignored)
//!   - blank lines         ignored
//!   - `[on.<trigger>]`    section header
//!   - `action_chain = ["a", "b", ...]` array assignment
//!
//! Any other key/value or syntax errors out.

use std::collections::BTreeMap;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ReactionConfig {
    /// trigger → action chain (in declaration order, kept stable via BTreeMap).
    pub triggers: BTreeMap<String, ReactionRule>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReactionRule {
    pub trigger: String,
    pub action_chain: Vec<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum ConfError {
    #[error("line {line}: {msg}")]
    Parse { line: usize, msg: String },
    #[error("duplicate trigger '{trigger}' at line {line}")]
    DuplicateTrigger { line: usize, trigger: String },
    #[error("missing action_chain for trigger '{trigger}'")]
    MissingActionChain { trigger: String },
}

pub fn parse(input: &str) -> Result<ReactionConfig, ConfError> {
    let mut cfg = ReactionConfig::default();
    let mut current: Option<(String, Vec<String>, Option<usize>)> = None;

    for (raw_idx, raw_line) in input.lines().enumerate() {
        let line_no = raw_idx + 1;
        let line = strip_comment(raw_line).trim();
        if line.is_empty() {
            continue;
        }

        if let Some(rest) = line.strip_prefix('[').and_then(|s| s.strip_suffix(']')) {
            // Flush any previous section.
            flush_current(&mut cfg, &mut current)?;
            let trigger = parse_header(rest, line_no)?;
            if cfg.triggers.contains_key(&trigger) {
                return Err(ConfError::DuplicateTrigger { line: line_no, trigger });
            }
            current = Some((trigger, Vec::new(), None));
            continue;
        }

        if let Some(eq) = line.find('=') {
            let key = line[..eq].trim();
            let value = line[eq + 1..].trim();
            let Some(section) = current.as_mut() else {
                return Err(ConfError::Parse {
                    line: line_no,
                    msg: "assignment outside [on.<trigger>] section".to_string(),
                });
            };
            match key {
                "action_chain" => {
                    section.1 = parse_string_array(value, line_no)?;
                    section.2 = Some(line_no);
                }
                other => {
                    return Err(ConfError::Parse {
                        line: line_no,
                        msg: format!("unknown key '{}'", other),
                    });
                }
            }
            continue;
        }

        return Err(ConfError::Parse {
            line: line_no,
            msg: format!("could not parse line: {:?}", line),
        });
    }

    flush_current(&mut cfg, &mut current)?;
    Ok(cfg)
}

fn flush_current(
    cfg: &mut ReactionConfig,
    current: &mut Option<(String, Vec<String>, Option<usize>)>,
) -> Result<(), ConfError> {
    if let Some((trigger, chain, seen_line)) = current.take() {
        if seen_line.is_none() {
            return Err(ConfError::MissingActionChain { trigger });
        }
        cfg.triggers.insert(
            trigger.clone(),
            ReactionRule { trigger, action_chain: chain },
        );
    }
    Ok(())
}

fn parse_header(rest: &str, line_no: usize) -> Result<String, ConfError> {
    let trimmed = rest.trim();
    let Some(name) = trimmed.strip_prefix("on.") else {
        return Err(ConfError::Parse {
            line: line_no,
            msg: format!("section must start with 'on.<trigger>', got [{}]", trimmed),
        });
    };
    if name.is_empty() {
        return Err(ConfError::Parse {
            line: line_no,
            msg: "empty trigger name in section header".to_string(),
        });
    }
    Ok(name.to_string())
}

fn parse_string_array(value: &str, line_no: usize) -> Result<Vec<String>, ConfError> {
    let v = value.trim();
    let Some(inner) = v.strip_prefix('[').and_then(|s| s.strip_suffix(']')) else {
        return Err(ConfError::Parse {
            line: line_no,
            msg: format!("expected array literal '[...]', got {}", v),
        });
    };
    let inner = inner.trim();
    if inner.is_empty() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for tok in inner.split(',') {
        let tok = tok.trim();
        let Some(s) = tok.strip_prefix('"').and_then(|s| s.strip_suffix('"')) else {
            return Err(ConfError::Parse {
                line: line_no,
                msg: format!("expected quoted string element, got {}", tok),
            });
        };
        out.push(s.to_string());
    }
    Ok(out)
}

fn strip_comment(line: &str) -> &str {
    match line.find('#') {
        Some(idx) => &line[..idx],
        None => line,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_minimal_example() {
        let cfg = parse(
            r#"
[on.issue_opened]
action_chain = ["triage", "route"]
"#,
        )
        .unwrap();
        let rule = cfg.triggers.get("issue_opened").unwrap();
        assert_eq!(rule.action_chain, vec!["triage", "route"]);
    }

    #[test]
    fn parses_multiple_triggers() {
        let cfg = parse(
            r#"
[on.issue_opened]
action_chain = ["triage"]

[on.review_requested]
action_chain = ["assign", "notify"]
"#,
        )
        .unwrap();
        assert_eq!(cfg.triggers.len(), 2);
        assert_eq!(
            cfg.triggers["review_requested"].action_chain,
            vec!["assign", "notify"]
        );
    }

    #[test]
    fn comments_and_blank_lines_ignored() {
        let cfg = parse(
            r#"
# top-of-file comment
[on.x]   # inline comment after header
action_chain = ["a"]   # inline after value

# trailing comment
"#,
        )
        .unwrap();
        assert_eq!(cfg.triggers["x"].action_chain, vec!["a"]);
    }

    #[test]
    fn empty_array_ok() {
        let cfg = parse(
            r#"
[on.noop]
action_chain = []
"#,
        )
        .unwrap();
        assert!(cfg.triggers["noop"].action_chain.is_empty());
    }

    #[test]
    fn duplicate_trigger_rejected() {
        let err = parse(
            r#"
[on.x]
action_chain = ["a"]

[on.x]
action_chain = ["b"]
"#,
        )
        .unwrap_err();
        assert!(matches!(err, ConfError::DuplicateTrigger { .. }));
    }

    #[test]
    fn missing_action_chain_rejected() {
        let err = parse("[on.x]\n").unwrap_err();
        assert!(matches!(err, ConfError::MissingActionChain { .. }));
    }

    #[test]
    fn assignment_outside_section_rejected() {
        let err = parse("action_chain = [\"a\"]\n").unwrap_err();
        assert!(matches!(err, ConfError::Parse { .. }));
    }

    #[test]
    fn unknown_key_rejected() {
        let err = parse(
            r#"
[on.x]
unknown_key = "y"
action_chain = ["a"]
"#,
        )
        .unwrap_err();
        assert!(matches!(err, ConfError::Parse { .. }));
    }

    #[test]
    fn malformed_array_rejected() {
        let err = parse(
            r#"
[on.x]
action_chain = "not an array"
"#,
        )
        .unwrap_err();
        assert!(matches!(err, ConfError::Parse { .. }));
    }

    #[test]
    fn malformed_section_rejected() {
        let err = parse(
            r#"
[event.x]
action_chain = ["a"]
"#,
        )
        .unwrap_err();
        assert!(matches!(err, ConfError::Parse { .. }));
    }

    #[test]
    fn empty_input_yields_empty_config() {
        let cfg = parse("").unwrap();
        assert!(cfg.triggers.is_empty());
    }
}
