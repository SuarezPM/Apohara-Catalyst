//! `dispatch_loop` coroutine — owns the Run flow. Receives `DispatchMsg::Run`
//! from the Objective/CommandPalette Run action and (W4.3/W4.4) spawns each
//! active provider CLI, streams stdout into `SSE_EVENTS`, runs the quality
//! gates, builds the winning `Diff`, and flips `RUNNING_STATUS` back to Idle.

use dioxus::prelude::*;
use futures_util::StreamExt;

use crate::state::running_status::{set_status, RunStatus};

/// Handle to the dispatch coroutine, published so the Run button can `.send()`.
pub static DISPATCH_TX: GlobalSignal<Option<Coroutine<DispatchMsg>>> = Signal::global(|| None);

/// Messages the dispatch loop accepts.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DispatchMsg {
    /// Run the given objective across the active providers.
    Run(String),
}

/// Mount the coroutine and publish its handle.
pub fn mount() {
    let tx = use_coroutine(|mut rx: UnboundedReceiver<DispatchMsg>| async move {
        while let Some(msg) = rx.next().await {
            match msg {
                DispatchMsg::Run(objective) => run_dispatch(objective).await,
            }
        }
    });
    use_effect(move || {
        *DISPATCH_TX.write() = Some(tx);
    });
}

/// Placeholder body until W4.3/W4.4 wire the real spawn + verify + diff flow.
/// Flips the run status so the UI reflects an in-flight run.
async fn run_dispatch(_objective: String) {
    set_status(RunStatus::Dispatching);
    set_status(RunStatus::Idle);
}
