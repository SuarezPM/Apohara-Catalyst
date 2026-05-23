//! CodeDiffPane — syntect-based syntax highlighting + naive line diff.
//!
//! Reference: `packages/desktop/src/components/CodeDiffPane.tsx` (monaco).
//!
//! Feature reduction (documented in `hard/mod.rs`): sin IntelliSense, sin
//! hover popups, sin go-to-def. Suficiente para el code-review path.
//!
//! The pure helpers (`highlight_line`, `diff_lines`) are exposed so the SSR
//! component and the unit tests can both rely on the same logic.
//!
//! Performance note: `SyntaxSet::load_defaults_newlines()` is non-trivial,
//! so we cache it (and the theme set) in a `OnceLock` rather than rebuilding
//! per line. A 100-line diff thus pays the syntect setup cost exactly once
//! per process lifetime.

use dioxus::prelude::*;
use std::sync::OnceLock;
use syntect::{
    easy::HighlightLines,
    highlighting::{Theme, ThemeSet},
    html::{styled_line_to_highlighted_html, IncludeBackground},
    parsing::SyntaxSet,
};

/// Lazy-loaded syntax set (bundled defaults — ~no I/O at runtime).
fn syntax_set() -> &'static SyntaxSet {
    static SYNTAXES: OnceLock<SyntaxSet> = OnceLock::new();
    SYNTAXES.get_or_init(SyntaxSet::load_defaults_newlines)
}

/// Lazy-loaded dark theme matching the React side's `vs-dark` Monaco look.
fn theme() -> &'static Theme {
    static THEME: OnceLock<Theme> = OnceLock::new();
    THEME.get_or_init(|| {
        let ts = ThemeSet::load_defaults();
        ts.themes
            .get("base16-ocean.dark")
            .cloned()
            .or_else(|| ts.themes.values().next().cloned())
            .expect("bundled themes always contain at least one entry")
    })
}

/// Render a single line of source as syntect-styled HTML.
///
/// The output is a sequence of `<span style="color:#…">…</span>` fragments
/// suitable for embedding into a `<pre>` via `dangerous_inner_html`. Unknown
/// extensions fall back to plain text (still wrapped in a span so callers
/// can rely on stable markup).
pub fn highlight_line(text: &str, ext: &str) -> String {
    let ps = syntax_set();
    let syntax = ps
        .find_syntax_by_extension(ext)
        .unwrap_or_else(|| ps.find_syntax_plain_text());
    let mut highlighter = HighlightLines::new(syntax, theme());
    match highlighter.highlight_line(text, ps) {
        Ok(regions) => styled_line_to_highlighted_html(&regions[..], IncludeBackground::No)
            .unwrap_or_else(|_| html_escape(text)),
        Err(_) => html_escape(text),
    }
}

/// Minimal HTML escape for the syntect fallback path. The success path
/// already escapes via `styled_line_to_highlighted_html`.
fn html_escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// One line of the rendered diff.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DiffLine {
    /// Source text of the line (without trailing newline).
    pub text: String,
    /// One of `"added"`, `"removed"`, `"unchanged"`. Stable strings —
    /// the SSR markup turns them into `diff-{kind}` CSS classes.
    pub kind: String,
}

/// Naive line-by-line diff. Walks both inputs in lockstep; for each
/// position emits `unchanged` when both sides match, or both `removed`
/// (lhs) and `added` (rhs) when they differ. Tail of the longer side is
/// emitted as `removed`/`added` accordingly.
///
/// This is intentionally not an LCS — the production code-review path
/// only needs to flag which lines moved, not the smallest possible edit
/// script. Monaco's diff editor uses Myers; matching that exactly is a
/// v1.1 follow-up.
pub fn diff_lines(lhs: &str, rhs: &str) -> Vec<DiffLine> {
    let lhs_lines: Vec<&str> = lhs.lines().collect();
    let rhs_lines: Vec<&str> = rhs.lines().collect();
    let mut out = Vec::with_capacity(lhs_lines.len().max(rhs_lines.len()));

    let max = lhs_lines.len().max(rhs_lines.len());
    for i in 0..max {
        match (lhs_lines.get(i), rhs_lines.get(i)) {
            (Some(a), Some(b)) if a == b => out.push(DiffLine {
                text: (*a).to_string(),
                kind: "unchanged".to_string(),
            }),
            (Some(a), Some(b)) => {
                out.push(DiffLine {
                    text: (*a).to_string(),
                    kind: "removed".to_string(),
                });
                out.push(DiffLine {
                    text: (*b).to_string(),
                    kind: "added".to_string(),
                });
            }
            (Some(a), None) => out.push(DiffLine {
                text: (*a).to_string(),
                kind: "removed".to_string(),
            }),
            (None, Some(b)) => out.push(DiffLine {
                text: (*b).to_string(),
                kind: "added".to_string(),
            }),
            (None, None) => {}
        }
    }
    out
}

/// SSR-friendly Dioxus component. Renders one `<div class="diff-line
/// diff-{kind}">` per `DiffLine`, with the syntect-highlighted source
/// inside a `<pre>` so the CSS marker (`+`, `-`, ` `) can hang off
/// `::before`.
///
/// The `ext` prop drives the syntect grammar selection (e.g. `"rs"`,
/// `"ts"`, `"py"`). Unknown extensions fall back to plain text via the
/// helper.
#[component]
pub fn CodeDiffPane(lhs: String, rhs: String, ext: String) -> Element {
    let diff = diff_lines(&lhs, &rhs);
    rsx! {
        div { class: "code-diff",
            for line in diff {
                div {
                    class: "diff-line diff-{line.kind}",
                    pre { dangerous_inner_html: highlight_line(&line.text, &ext) }
                }
            }
        }
    }
}
