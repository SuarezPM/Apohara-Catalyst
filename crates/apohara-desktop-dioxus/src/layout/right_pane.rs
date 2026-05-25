//! Right pane slot (grid-area: right). Shows the winning provider's diff from
//! CODE_DIFF: empty-state when None; provider_winner badge + files_changed +
//! unified diff body + Accept/Reject when Some (W3.C.1, W3.C.2).
//!
//! The `Diff` signal carries a pre-computed unified diff string (plus metadata),
//! so this pane renders it directly rather than going through the syntect
//! `CodeDiffPane` component (whose lhs/rhs API is the richer v1.1 path).

use dioxus::prelude::*;

use crate::state::code_diff::{self, CODE_DIFF};

/// Accept the current diff: hand it to the `git_apply_handler` coroutine, which
/// runs `git apply` against the working tree (W4.7). No-op until the coroutine
/// is mounted on the desktop runtime.
pub(crate) fn accept_diff() {
    if let Some(tx) = crate::coroutines::git_apply_handler::GIT_APPLY_TX.read().as_ref() {
        tx.send(crate::coroutines::git_apply_handler::GitApplyMsg::Accept);
    }
}

/// Reject the current diff: clear CODE_DIFF so the pane returns to empty-state.
pub(crate) fn reject_diff() {
    code_diff::clear();
}

/// Classify a unified-diff line by its leading marker for CSS hooks.
fn diff_line_kind(line: &str) -> &'static str {
    if line.starts_with("+++") || line.starts_with("---") || line.starts_with("@@") {
        "meta"
    } else if line.starts_with('+') {
        "added"
    } else if line.starts_with('-') {
        "removed"
    } else {
        "unchanged"
    }
}

#[component]
pub fn RightPane() -> Element {
    let diff = CODE_DIFF.read().clone();
    rsx! {
        div { class: "right", "data-testid": "layout-right",
            {
                match diff {
                    None => rsx! {
                        div {
                            class: "card code-diff-empty",
                            "data-testid": "code-diff-empty",
                            p { "No diff yet \u{2014} run a goal" }
                        }
                    },
                    Some(d) => rsx! {
                        div { class: "code-diff-pane", "data-testid": "code-diff-pane",
                            header { class: "code-diff-header",
                                span {
                                    class: "code-diff-winner",
                                    "data-testid": "code-diff-winner",
                                    "{d.provider_winner}"
                                }
                                ul {
                                    class: "code-diff-files",
                                    "data-testid": "code-diff-files",
                                    for f in d.files_changed.iter() {
                                        li { class: "code-diff-file", "{f}" }
                                    }
                                }
                            }
                            div { class: "code-diff-body",
                                for line in d.unified.lines() {
                                    {
                                        let kind = diff_line_kind(line);
                                        rsx! {
                                            div { class: "diff-line diff-{kind}",
                                                pre { "{line}" }
                                            }
                                        }
                                    }
                                }
                            }
                            div { class: "code-diff-actions",
                                button {
                                    r#type: "button",
                                    class: "btn btn-primary",
                                    "data-testid": "code-diff-accept",
                                    onclick: move |_| accept_diff(),
                                    "Accept"
                                }
                                button {
                                    r#type: "button",
                                    class: "btn btn-secondary",
                                    "data-testid": "code-diff-reject",
                                    onclick: move |_| reject_diff(),
                                    "Reject"
                                }
                            }
                        }
                    },
                }
            }
        }
    }
}
