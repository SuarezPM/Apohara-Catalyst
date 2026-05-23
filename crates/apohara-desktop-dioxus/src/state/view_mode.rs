//! Active view mode — replaces `packages/desktop/src/store/viewStore.ts`.
//!
//! The TS atom persisted to `window.localStorage`. The Dioxus desktop has
//! no `window` global; persistence will hop onto the tauri/dioxus disk
//! adapter in G2.D. For G2.C.1 the signal is in-memory only — the same
//! shape as the TS atom, minus the side effect.

use dioxus::prelude::*;

/// The 3 desktop view modes. Mirrors the `ViewMode` literal union from
/// `viewStore.ts`. `Graph` is the default to match the TS `loadInitial()`
/// fallback.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum ViewMode {
    #[default]
    Graph,
    Board,
    Terminal,
}

/// Root signal carrying the active view.
pub static VIEW_MODE: GlobalSignal<ViewMode> = Signal::global(ViewMode::default);

/// Replace the active view mode.
pub fn set_view_mode(mode: ViewMode) {
    *VIEW_MODE.write() = mode;
}
