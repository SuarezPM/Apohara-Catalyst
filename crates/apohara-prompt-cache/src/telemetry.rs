//! Read-only telemetry hooks for the prompt cache.
//!
//! Phase 3 wires up the counters; self-tuning logic (e.g. flipping L3
//! off after sustained over-budget hit latency, raising L2 bucket
//! thresholds, etc.) is deferred to Phase 4. The atomics below are
//! safe to read from any thread without locking, and `reset()` exists
//! only because Pablo asked for a user-initiated reset (not for use
//! inside the cache itself).
//!
//! Latency tracking uses a microsecond budget knob — the default of
//! 5000 µs matches the latency budget target in the plan
//! (Risk #2 mitigation).

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

/// Atomic counters describing cache behaviour. All getters are O(1)
/// non-blocking loads; suitable for polling from a UI dashboard.
#[derive(Debug)]
pub struct CacheTelemetry {
    budget_micros: AtomicU64,
    total_lookups: AtomicU64,
    hot_hits: AtomicU64,
    warm_hits: AtomicU64,
    misses: AtomicU64,
    disabled: AtomicU64,
    over_budget: AtomicU64,
    sum_micros: AtomicU64,
    stores: AtomicU64,
    l2_rejects: AtomicU64,
}

impl Default for CacheTelemetry {
    fn default() -> Self {
        Self::with_budget(Duration::from_micros(5000))
    }
}

impl CacheTelemetry {
    pub fn with_budget(budget: Duration) -> Self {
        Self {
            budget_micros: AtomicU64::new(budget.as_micros() as u64),
            total_lookups: AtomicU64::new(0),
            hot_hits: AtomicU64::new(0),
            warm_hits: AtomicU64::new(0),
            misses: AtomicU64::new(0),
            disabled: AtomicU64::new(0),
            over_budget: AtomicU64::new(0),
            sum_micros: AtomicU64::new(0),
            stores: AtomicU64::new(0),
            l2_rejects: AtomicU64::new(0),
        }
    }

    // ---- recorders ---------------------------------------------------------

    pub fn record_hot_hit(&self, elapsed: Duration) {
        self.hot_hits.fetch_add(1, Ordering::Relaxed);
        self.record_latency(elapsed);
    }

    pub fn record_warm_hit(&self, elapsed: Duration) {
        self.warm_hits.fetch_add(1, Ordering::Relaxed);
        self.record_latency(elapsed);
    }

    pub fn record_miss(&self, elapsed: Duration) {
        self.misses.fetch_add(1, Ordering::Relaxed);
        self.record_latency(elapsed);
    }

    pub fn record_disabled(&self) {
        self.disabled.fetch_add(1, Ordering::Relaxed);
    }

    pub fn record_store(&self) {
        self.stores.fetch_add(1, Ordering::Relaxed);
    }

    pub fn record_l2_reject(&self) {
        self.l2_rejects.fetch_add(1, Ordering::Relaxed);
    }

    fn record_latency(&self, elapsed: Duration) {
        let micros = elapsed.as_micros() as u64;
        self.total_lookups.fetch_add(1, Ordering::Relaxed);
        self.sum_micros.fetch_add(micros, Ordering::Relaxed);
        if micros > self.budget_micros.load(Ordering::Relaxed) {
            self.over_budget.fetch_add(1, Ordering::Relaxed);
        }
    }

    // ---- read-only getters -------------------------------------------------

    pub fn budget_micros(&self) -> u64 {
        self.budget_micros.load(Ordering::Relaxed)
    }
    pub fn total_lookups(&self) -> u64 {
        self.total_lookups.load(Ordering::Relaxed)
    }
    pub fn hot_hits(&self) -> u64 {
        self.hot_hits.load(Ordering::Relaxed)
    }
    pub fn warm_hits(&self) -> u64 {
        self.warm_hits.load(Ordering::Relaxed)
    }
    pub fn misses(&self) -> u64 {
        self.misses.load(Ordering::Relaxed)
    }
    pub fn disabled(&self) -> u64 {
        self.disabled.load(Ordering::Relaxed)
    }
    pub fn over_budget(&self) -> u64 {
        self.over_budget.load(Ordering::Relaxed)
    }
    pub fn stores(&self) -> u64 {
        self.stores.load(Ordering::Relaxed)
    }
    pub fn l2_rejects(&self) -> u64 {
        self.l2_rejects.load(Ordering::Relaxed)
    }

    /// Mean lookup latency in microseconds, or 0 if no lookups yet.
    pub fn avg_micros(&self) -> u64 {
        self.sum_micros
            .load(Ordering::Relaxed)
            .checked_div(self.total_lookups())
            .unwrap_or(0)
    }

    /// `(hits) / (hits + misses)` as a value in `[0.0, 1.0]`. `Disabled`
    /// invocations are excluded so a long-disabled run does not skew
    /// the metric.
    pub fn hit_ratio(&self) -> f64 {
        let hits = self.hot_hits() + self.warm_hits();
        let total = hits + self.misses();
        if total == 0 {
            0.0
        } else {
            hits as f64 / total as f64
        }
    }

    /// User-initiated reset. Phase 4 self-tuning will rely on a manual
    /// reset boundary rather than auto-rotating internally.
    pub fn reset(&self) {
        self.total_lookups.store(0, Ordering::Relaxed);
        self.hot_hits.store(0, Ordering::Relaxed);
        self.warm_hits.store(0, Ordering::Relaxed);
        self.misses.store(0, Ordering::Relaxed);
        self.disabled.store(0, Ordering::Relaxed);
        self.over_budget.store(0, Ordering::Relaxed);
        self.sum_micros.store(0, Ordering::Relaxed);
        self.stores.store(0, Ordering::Relaxed);
        self.l2_rejects.store(0, Ordering::Relaxed);
    }
}

/// Run `op`, attribute its latency to `telemetry` via `record`. Caller
/// passes the recorder so the same `with_latency` helper covers hot
/// hits, warm hits, and misses without three near-identical wrappers.
pub fn with_latency<T, F: FnOnce() -> T>(
    telemetry: &CacheTelemetry,
    record: impl FnOnce(&CacheTelemetry, Duration),
    op: F,
) -> T {
    let start = Instant::now();
    let out = op();
    record(telemetry, start.elapsed());
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_zero_counters_and_5000us_budget() {
        let t = CacheTelemetry::default();
        assert_eq!(t.total_lookups(), 0);
        assert_eq!(t.hot_hits(), 0);
        assert_eq!(t.warm_hits(), 0);
        assert_eq!(t.misses(), 0);
        assert_eq!(t.over_budget(), 0);
        assert_eq!(t.avg_micros(), 0);
        assert_eq!(t.hit_ratio(), 0.0);
        assert_eq!(t.budget_micros(), 5000);
    }

    #[test]
    fn record_hot_hit_increments_counters() {
        let t = CacheTelemetry::default();
        t.record_hot_hit(Duration::from_micros(123));
        assert_eq!(t.hot_hits(), 1);
        assert_eq!(t.total_lookups(), 1);
    }

    #[test]
    fn record_over_budget_lookup_increments_over_budget() {
        let t = CacheTelemetry::with_budget(Duration::from_micros(100));
        t.record_miss(Duration::from_micros(1_000));
        assert_eq!(t.over_budget(), 1);
        assert_eq!(t.misses(), 1);
    }

    #[test]
    fn record_within_budget_does_not_increment_over_budget() {
        let t = CacheTelemetry::with_budget(Duration::from_micros(5000));
        t.record_hot_hit(Duration::from_micros(50));
        assert_eq!(t.over_budget(), 0);
    }

    #[test]
    fn avg_micros_computes_mean() {
        let t = CacheTelemetry::default();
        t.record_hot_hit(Duration::from_micros(100));
        t.record_hot_hit(Duration::from_micros(300));
        assert_eq!(t.avg_micros(), 200);
    }

    #[test]
    fn hit_ratio_excludes_disabled() {
        let t = CacheTelemetry::default();
        t.record_hot_hit(Duration::from_micros(10));
        t.record_warm_hit(Duration::from_micros(20));
        t.record_miss(Duration::from_micros(30));
        t.record_disabled(); // must NOT shift ratio
        t.record_disabled();
        assert!((t.hit_ratio() - (2.0 / 3.0)).abs() < 1e-9);
    }

    #[test]
    fn reset_zeroes_counters_preserves_budget() {
        let t = CacheTelemetry::with_budget(Duration::from_micros(777));
        t.record_hot_hit(Duration::from_micros(50));
        t.record_miss(Duration::from_micros(80));
        t.record_store();
        t.reset();
        assert_eq!(t.total_lookups(), 0);
        assert_eq!(t.hot_hits(), 0);
        assert_eq!(t.misses(), 0);
        assert_eq!(t.stores(), 0);
        assert_eq!(
            t.budget_micros(),
            777,
            "reset must NOT clobber the configured budget"
        );
    }

    #[test]
    fn with_latency_records_elapsed_via_recorder() {
        let t = CacheTelemetry::default();
        let v = with_latency(&t, CacheTelemetry::record_hot_hit, || 42);
        assert_eq!(v, 42);
        assert_eq!(t.hot_hits(), 1);
    }
}
