//! `git_apply_handler` coroutine — applies the accepted diff to the working
//! tree. Receives `GitApplyMsg::Accept` from the CodeDiffPane Accept button;
//! the real `git apply` lands in W4.7.

use dioxus::prelude::*;
use futures_util::StreamExt;

/// Handle to the git-apply coroutine, published so the Accept button can `.send()`.
pub static GIT_APPLY_TX: GlobalSignal<Option<Coroutine<GitApplyMsg>>> = Signal::global(|| None);

/// Messages the git-apply handler accepts.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum GitApplyMsg {
    /// Apply the current `CODE_DIFF` to the working tree.
    Accept,
}

/// Mount the coroutine and publish its handle.
pub fn mount() {
    let tx = use_coroutine(|mut rx: UnboundedReceiver<GitApplyMsg>| async move {
        while let Some(msg) = rx.next().await {
            match msg {
                // Real `git apply` + result toast land in W4.7.
                GitApplyMsg::Accept => {}
            }
        }
    });
    use_effect(move || {
        *GIT_APPLY_TX.write() = Some(tx);
    });
}
