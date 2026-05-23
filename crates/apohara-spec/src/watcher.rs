//! Plan file watcher (port of `src/core/spec/watcher.ts`).
//!
//! `chokidar` (TS) replaced by `notify-rs`. On change/add/unlink of any
//! `*.md` file under the watched root:
//!   - invalidate the cache for the affected file;
//!   - publish a [`WatcherEvent`] that the caller (UI / orchestrator)
//!     turns into the equivalent `apohara://plan-*` dispatch.
//!
//! Hot-reload validate mode (`hot_reload_validate: true`): on add/change
//! the watcher eagerly reparses the file. On parse success we clear the
//! cache (next read repopulates) and emit `Changed` / `Added`. On parse
//! failure we LEAVE the cache intact so consumers keep seeing the
//! last-known-good plan, and emit [`WatcherEvent::Invalid`] with the
//! parser error so the UI can flag the file. This guards against
//! half-saved edits evicting good plans mid-write.

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Sender};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;
use thiserror::Error;

use crate::plan_documents::parse_plan_document_str;
use crate::plan_status_cache::PlanStatusCache;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WatcherEvent {
    Added(PathBuf),
    Changed(PathBuf),
    Removed(PathBuf),
    /// Hot-reload validate mode and the new content failed to parse.
    /// The cache entry was preserved (last-known-good).
    Invalid { path: PathBuf, error: String },
}

#[derive(Debug, Error)]
pub enum WatcherError {
    #[error("notify error: {0}")]
    Notify(#[from] notify::Error),
}

pub struct PlanWatcherHandle {
    _watcher: RecommendedWatcher,
    shutdown: Sender<()>,
    join: Option<JoinHandle<()>>,
}

impl PlanWatcherHandle {
    /// Stop the watcher and join the dispatcher thread.
    pub fn close(mut self) {
        let _ = self.shutdown.send(());
        if let Some(j) = self.join.take() {
            let _ = j.join();
        }
    }
}

pub struct PlanWatcherOpts {
    pub root_path: PathBuf,
    pub cache: Arc<PlanStatusCache>,
    /// If true, the watcher eagerly reparses on change/add. On failure
    /// the cache entry is preserved and `Invalid` is emitted instead of
    /// `Changed`/`Added`.
    pub hot_reload_validate: bool,
}

/// Start the watcher. `on_event` is called from a dedicated dispatcher
/// thread — keep it cheap (do not block on UI / IO).
pub fn start_plan_watcher<F>(
    opts: PlanWatcherOpts,
    on_event: F,
) -> Result<PlanWatcherHandle, WatcherError>
where
    F: Fn(WatcherEvent) + Send + Sync + 'static,
{
    let (tx_notify, rx_notify) = channel::<notify::Result<Event>>();
    let (tx_shutdown, rx_shutdown) = channel::<()>();

    let mut watcher: RecommendedWatcher = notify::recommended_watcher(tx_notify)?;
    watcher.watch(&opts.root_path, RecursiveMode::Recursive)?;

    let cache = Arc::clone(&opts.cache);
    let hot_reload = opts.hot_reload_validate;
    let on_event = Arc::new(on_event);

    let join = thread::spawn(move || loop {
        // Tight loop with a small timeout so shutdown is responsive
        // without thrashing the CPU.
        if rx_shutdown.try_recv().is_ok() {
            break;
        }
        match rx_notify.recv_timeout(Duration::from_millis(100)) {
            Ok(Ok(event)) => handle_event(event, &cache, hot_reload, &on_event),
            Ok(Err(e)) => tracing::warn!(error = %e, "plan watcher notify error"),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        }
    });

    Ok(PlanWatcherHandle {
        _watcher: watcher,
        shutdown: tx_shutdown,
        join: Some(join),
    })
}

fn handle_event<F>(event: Event, cache: &Arc<PlanStatusCache>, hot_reload: bool, on_event: &Arc<F>)
where
    F: Fn(WatcherEvent) + Send + Sync + 'static,
{
    for path in event.paths.into_iter() {
        if !is_markdown(&path) {
            continue;
        }
        match event.kind {
            EventKind::Create(_) => dispatch_add_or_change(&path, cache, hot_reload, on_event, true),
            EventKind::Modify(_) => {
                dispatch_add_or_change(&path, cache, hot_reload, on_event, false)
            }
            EventKind::Remove(_) => {
                cache.clear(&path);
                on_event(WatcherEvent::Removed(path));
            }
            _ => {}
        }
    }
}

fn dispatch_add_or_change<F>(
    path: &Path,
    cache: &Arc<PlanStatusCache>,
    hot_reload: bool,
    on_event: &Arc<F>,
    is_create: bool,
) where
    F: Fn(WatcherEvent) + Send + Sync + 'static,
{
    let make = |path: PathBuf| {
        if is_create {
            WatcherEvent::Added(path)
        } else {
            WatcherEvent::Changed(path)
        }
    };

    if !hot_reload {
        cache.clear(path);
        on_event(make(path.to_path_buf()));
        return;
    }

    // Validated hot-reload: try to parse; on failure, keep cache and
    // emit Invalid so the UI can flag the broken edit.
    match std::fs::read_to_string(path) {
        Ok(raw) => match parse_plan_document_str(path, &raw) {
            Ok(_plan) => {
                cache.clear(path);
                on_event(make(path.to_path_buf()));
            }
            Err(err) => on_event(WatcherEvent::Invalid {
                path: path.to_path_buf(),
                error: err.to_string(),
            }),
        },
        Err(err) => on_event(WatcherEvent::Invalid {
            path: path.to_path_buf(),
            error: err.to_string(),
        }),
    }
}

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("md"))
        .unwrap_or(false)
}

/// Test-only re-export so tests outside this module can exercise the
/// extension filter without rebuilding a tempdir + watcher.
#[cfg(test)]
pub(crate) fn is_markdown_for_test(path: &Path) -> bool {
    is_markdown(path)
}
