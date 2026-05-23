//! Bash compound command splitter — INV-bash-scope invariant.
//!
//! Ported from `src/core/safety/bashCompoundAnalyzer.ts`. Critical:
//! the naive `cmd.split("&&|;")` is unsafe because it misses single
//! pipes, single ampersands, command/process substitution, and
//! quote-aware separators. This implementation walks the string
//! character-by-character tracking quote state and recursively extracts
//! substitution bodies as their own subcommands.
//!
//! See the regression test `inv_bash_scope_compound_commands_always_scoped`
//! below for the load-bearing cases.
//!
//! History: this invariant was called `INV-15` in the TS legacy code
//! (TS Sprint 5). Renamed to `INV-bash-scope` in Rust Sprint 22 (G3.C)
//! to disambiguate from the unrelated `INV-15 JCR Safety Gate` (paper
//! reference DOI 10.5281/zenodo.20114594), which is a verification-mesh
//! confidence-threshold invariant — not the compound-bash one.

/// Split a bash command line into its compound subcommands.
///
/// Returns `vec![cmd]` for non-compound commands, otherwise one entry
/// per detected subcommand. Command/process substitutions (`$()`,
/// backticks, `<()`, `>()`) are extracted recursively so a per-leg
/// permission policy can reason about them in isolation.
pub fn split_compound(command: &str) -> Vec<String> {
    let bytes = command.as_bytes();
    let mut result: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut i = 0usize;
    let mut in_double = false;
    let mut in_single = false;

    let push_current = |current: &mut String, result: &mut Vec<String>| {
        let t = current.trim();
        if !t.is_empty() {
            result.push(t.to_string());
        }
        current.clear();
    };

    while i < bytes.len() {
        let c = bytes[i];
        let next = bytes.get(i + 1).copied();

        // Backslash escape (outside single quotes — bash doesn't honor
        // `\` in single-quoted strings).
        if !in_single && c == b'\\' && i + 1 < bytes.len() {
            current.push(c as char);
            current.push(bytes[i + 1] as char);
            i += 2;
            continue;
        }

        // Quote toggles. Keep the quote character in `current` so callers
        // see the original token text.
        if c == b'"' && !in_single {
            in_double = !in_double;
            current.push(c as char);
            i += 1;
            continue;
        }
        if c == b'\'' && !in_double {
            in_single = !in_single;
            current.push(c as char);
            i += 1;
            continue;
        }

        if !in_double && !in_single {
            // $(...) command substitution
            if c == b'$' && next == Some(b'(') {
                push_current(&mut current, &mut result);
                i += 2;
                let mut depth = 1usize;
                let mut inner = String::new();
                while i < bytes.len() && depth > 0 {
                    let ic = bytes[i];
                    if ic == b'\\' && i + 1 < bytes.len() {
                        inner.push(ic as char);
                        inner.push(bytes[i + 1] as char);
                        i += 2;
                        continue;
                    }
                    if ic == b'(' {
                        depth += 1;
                    } else if ic == b')' {
                        depth -= 1;
                        if depth == 0 {
                            i += 1;
                            break;
                        }
                    }
                    inner.push(ic as char);
                    i += 1;
                }
                for sub in split_compound(&inner) {
                    result.push(sub);
                }
                continue;
            }
            // backtick command substitution
            if c == b'`' {
                push_current(&mut current, &mut result);
                i += 1;
                let mut inner = String::new();
                while i < bytes.len() && bytes[i] != b'`' {
                    if bytes[i] == b'\\' && i + 1 < bytes.len() {
                        inner.push(bytes[i] as char);
                        inner.push(bytes[i + 1] as char);
                        i += 2;
                        continue;
                    }
                    inner.push(bytes[i] as char);
                    i += 1;
                }
                if i < bytes.len() {
                    i += 1; // skip closing `
                }
                for sub in split_compound(&inner) {
                    result.push(sub);
                }
                continue;
            }
            // <(...) and >(...) process substitution
            if (c == b'<' || c == b'>') && next == Some(b'(') {
                push_current(&mut current, &mut result);
                i += 2;
                let mut depth = 1usize;
                let mut inner = String::new();
                while i < bytes.len() && depth > 0 {
                    let ic = bytes[i];
                    if ic == b'\\' && i + 1 < bytes.len() {
                        inner.push(ic as char);
                        inner.push(bytes[i + 1] as char);
                        i += 2;
                        continue;
                    }
                    if ic == b'(' {
                        depth += 1;
                    } else if ic == b')' {
                        depth -= 1;
                        if depth == 0 {
                            i += 1;
                            break;
                        }
                    }
                    inner.push(ic as char);
                    i += 1;
                }
                for sub in split_compound(&inner) {
                    result.push(sub);
                }
                continue;
            }
            // && and ||
            if c == b'&' && next == Some(b'&') {
                push_current(&mut current, &mut result);
                i += 2;
                continue;
            }
            if c == b'|' && next == Some(b'|') {
                push_current(&mut current, &mut result);
                i += 2;
                continue;
            }
            // ; statement terminator
            if c == b';' {
                push_current(&mut current, &mut result);
                i += 1;
                continue;
            }
            // | pipe
            if c == b'|' {
                push_current(&mut current, &mut result);
                i += 1;
                continue;
            }
            // & job-background
            if c == b'&' {
                push_current(&mut current, &mut result);
                i += 1;
                continue;
            }
            // newline as statement terminator
            if c == b'\n' {
                push_current(&mut current, &mut result);
                i += 1;
                continue;
            }
        }

        current.push(c as char);
        i += 1;
    }
    push_current(&mut current, &mut result);
    result
}

/// True iff the command contains MORE THAN ONE logical leg after
/// compound analysis. Per INV-bash-scope, compound commands must
/// always be scope-clamped to one-shot approval — never `session` or
/// `always`.
pub fn is_compound(command: &str) -> bool {
    split_compound(command).len() > 1
}
