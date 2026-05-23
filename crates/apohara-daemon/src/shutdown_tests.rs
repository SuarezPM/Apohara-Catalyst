use super::shutdown::ShutdownController;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

#[tokio::test]
async fn trigger_wakes_waiters() {
    let s = ShutdownController::new();
    let s2 = s.clone();
    let handle = tokio::spawn(async move {
        s2.wait().await;
    });
    s.trigger().await;
    handle.await.unwrap();
    assert!(s.is_shutting_down());
}

#[tokio::test]
async fn checkpoints_run_in_order() {
    let s = ShutdownController::new();
    let order = Arc::new(std::sync::Mutex::new(Vec::<usize>::new()));
    for i in 0..3usize {
        let order = order.clone();
        s.register_checkpoint(move || {
            Box::pin(async move {
                order.lock().unwrap().push(i);
            })
        })
        .await;
    }
    s.trigger().await;
    assert_eq!(*order.lock().unwrap(), vec![0, 1, 2]);
}

#[tokio::test]
async fn trigger_drains_queue_so_late_register_runs_on_next_trigger() {
    let s = ShutdownController::new();
    let counter = Arc::new(AtomicUsize::new(0));
    let c = counter.clone();
    s.register_checkpoint(move || {
        Box::pin(async move {
            c.fetch_add(1, Ordering::Relaxed);
        })
    })
    .await;
    s.trigger().await;
    assert_eq!(counter.load(Ordering::Relaxed), 1);
    // Late checkpoint registered after first trigger; runs only on second.
    let c2 = counter.clone();
    s.register_checkpoint(move || {
        Box::pin(async move {
            c2.fetch_add(10, Ordering::Relaxed);
        })
    })
    .await;
    assert_eq!(counter.load(Ordering::Relaxed), 1);
    s.trigger().await;
    assert_eq!(counter.load(Ordering::Relaxed), 11);
}

#[tokio::test]
async fn wait_returns_immediately_when_already_shutdown() {
    let s = ShutdownController::new();
    s.trigger().await;
    // Should not block.
    tokio::time::timeout(std::time::Duration::from_millis(100), s.wait())
        .await
        .expect("wait should return immediately when already shut down");
}
