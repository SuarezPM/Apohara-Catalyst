//! Graceful shutdown controller (G6.A.11).
//!
//! Used by the daemon binary to wait for SIGTERM/SIGINT, run any registered
//! checkpoint closures, and notify subscribers via a watch channel. Tested
//! head-on through `trigger()`; the SIGTERM listener is best-effort and only
//! attached when running outside tests.

use std::sync::Arc;
use tokio::sync::{watch, Mutex};

/// Closure run during shutdown — async, returns nothing. Errors are logged
/// and do not block other checkpoints from running.
type CheckpointFn = Box<dyn FnOnce() -> futures::future::BoxFuture<'static, ()> + Send + 'static>;

#[derive(Clone)]
pub struct ShutdownController {
    inner: Arc<Inner>,
}

struct Inner {
    notify_tx: watch::Sender<bool>,
    notify_rx: watch::Receiver<bool>,
    checkpoints: Mutex<Vec<CheckpointFn>>,
}

impl ShutdownController {
    pub fn new() -> Self {
        let (notify_tx, notify_rx) = watch::channel(false);
        Self {
            inner: Arc::new(Inner {
                notify_tx,
                notify_rx,
                checkpoints: Mutex::new(Vec::new()),
            }),
        }
    }

    /// Register a checkpoint that runs (in registration order) when shutdown
    /// is triggered. Idempotent in the sense that each checkpoint runs at
    /// most once: the trigger drains the queue.
    pub async fn register_checkpoint<F>(&self, f: F)
    where
        F: FnOnce() -> futures::future::BoxFuture<'static, ()> + Send + 'static,
    {
        let mut g = self.inner.checkpoints.lock().await;
        g.push(Box::new(f));
    }

    /// Manually trigger shutdown — used by tests and the SIGTERM handler.
    /// Runs all registered checkpoints sequentially, then flips the notify
    /// channel so waiters wake up.
    pub async fn trigger(&self) {
        let mut g = self.inner.checkpoints.lock().await;
        let queue = std::mem::take(&mut *g);
        drop(g);
        for cp in queue {
            cp().await;
        }
        // Ignore send error: if there are no waiters, that's fine — the value
        // is still latched on the watch channel for late subscribers.
        let _ = self.inner.notify_tx.send(true);
    }

    /// Wait for the trigger. Returns immediately if already shut down.
    pub async fn wait(&self) {
        let mut rx = self.inner.notify_rx.clone();
        if *rx.borrow() {
            return;
        }
        while rx.changed().await.is_ok() {
            if *rx.borrow() {
                return;
            }
        }
    }

    /// Spawn the unix SIGTERM/SIGINT listener. No-op on platforms where it
    /// isn't supported (Windows uses ctrl-c).
    #[cfg(not(test))]
    pub fn spawn_signal_listener(&self) {
        let me = self.clone();
        tokio::spawn(async move {
            #[cfg(unix)]
            {
                use tokio::signal::unix::{signal, SignalKind};
                let mut term = match signal(SignalKind::terminate()) {
                    Ok(s) => s,
                    Err(_) => return,
                };
                let mut intr = match signal(SignalKind::interrupt()) {
                    Ok(s) => s,
                    Err(_) => return,
                };
                tokio::select! {
                    _ = term.recv() => {},
                    _ = intr.recv() => {},
                }
            }
            #[cfg(not(unix))]
            {
                let _ = tokio::signal::ctrl_c().await;
            }
            me.trigger().await;
        });
    }

    #[cfg(test)]
    pub fn spawn_signal_listener(&self) {
        // No-op in tests: trigger() is the explicit entry-point.
    }

    pub fn is_shutting_down(&self) -> bool {
        *self.inner.notify_rx.borrow()
    }
}

impl Default for ShutdownController {
    fn default() -> Self {
        Self::new()
    }
}
