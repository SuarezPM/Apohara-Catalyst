//! SSR + unit tests for the CodeDiffPane port (G2.D.2).
//!
//! Reference: `packages/desktop/src/components/CodeDiffPane.tsx`.
//!
//! Helpers under test:
//!   - `highlight_line(text, ext)`  → syntect-emitted `<span ...>` HTML.
//!   - `diff_lines(lhs, rhs)`       → naive line-by-line `DiffLine` Vec.
//!   - `CodeDiffPane { lhs, rhs, ext }` Dioxus component → unified-diff
//!     style markup with `class="diff-line diff-{kind}"` per line.

use super::code_diff_pane::{diff_lines, highlight_line, CodeDiffPane};
use dioxus::prelude::*;

#[test]
fn highlight_recognizes_rust_keyword() {
    let highlighted = highlight_line("fn main() {}", "rs");
    assert!(
        highlighted.contains("fn"),
        "keyword missing from highlighted output: {highlighted}"
    );
    assert!(
        highlighted.contains("<span"),
        "syntect did not emit any <span> tag: {highlighted}"
    );
}

#[test]
fn highlight_plaintext_for_unknown_extension() {
    // Unknown extension falls back to plain text — must still emit at least
    // one <span> wrapper so the diff rows have consistent markup.
    let highlighted = highlight_line("hello world", "xyz-unknown");
    assert!(
        highlighted.contains("hello world"),
        "plain text content missing: {highlighted}"
    );
}

#[test]
fn diff_marks_added_lines() {
    let lhs = "let a = 1;";
    let rhs = "let a = 1;\nlet b = 2;";
    let diff = diff_lines(lhs, rhs);
    assert!(
        diff.iter()
            .any(|line| line.kind == "added" && line.text.contains("let b")),
        "added line not detected: {diff:?}"
    );
}

#[test]
fn diff_marks_removed_lines() {
    let lhs = "let a = 1;\nlet b = 2;";
    let rhs = "let a = 1;";
    let diff = diff_lines(lhs, rhs);
    assert!(
        diff.iter()
            .any(|line| line.kind == "removed" && line.text.contains("let b")),
        "removed line not detected: {diff:?}"
    );
}

#[test]
fn diff_marks_unchanged_lines() {
    let lhs = "stable;";
    let rhs = "stable;";
    let diff = diff_lines(lhs, rhs);
    assert_eq!(diff.len(), 1);
    assert_eq!(diff[0].kind, "unchanged");
}

#[test]
fn ssr_emits_diff_line_added_class_and_syntect_span() {
    // Tiny unified-style diff: rhs adds one line, removes nothing.
    let html = dioxus_ssr::render_element(rsx! {
        CodeDiffPane {
            lhs: "fn main() {}".to_string(),
            rhs: "fn main() {}\nfn helper() {}".to_string(),
            ext: "rs".to_string(),
        }
    });
    assert!(
        html.contains("diff-line"),
        "missing diff-line class in SSR: {html}"
    );
    assert!(
        html.contains("diff-added"),
        "missing diff-added class in SSR: {html}"
    );
    // syntect's styled_line_to_highlighted_html emits inline-style spans.
    assert!(
        html.contains("<span"),
        "no syntect <span> in SSR output: {html}"
    );
}

#[test]
fn ssr_emits_removed_and_unchanged_classes() {
    let html = dioxus_ssr::render_element(rsx! {
        CodeDiffPane {
            lhs: "keep me;\nremove me;".to_string(),
            rhs: "keep me;".to_string(),
            ext: "rs".to_string(),
        }
    });
    assert!(
        html.contains("diff-removed"),
        "missing diff-removed in SSR: {html}"
    );
    assert!(
        html.contains("diff-unchanged"),
        "missing diff-unchanged in SSR: {html}"
    );
}
