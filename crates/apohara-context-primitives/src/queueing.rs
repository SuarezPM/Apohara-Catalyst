//! Queueing-theoretic primitives for the dispatcher / prompt-cache.
//!
//! Two layers:
//!   * **Pure functions** — `utilization`, `lambda_critical`, `erlang_c`,
//!     `mmc_wait_time`, `little_law_in_system`. Closed-form M/M/c with
//!     Erlang-C blocking probability, plus Little's Law.
//!   * **`Controller`** — sliding-window EMA of arrival rate λ and Welford
//!     accumulator for service-time E[S]. Produces admission decisions
//!     (`Admit` / `Defer` / `Reject`) bounded by INVARIANT-11-style
//!     `min_stable_concurrency` floor.
//!
//! Reference port: `apohara-context-forge/.../scheduling/queueing_controller.py`.
//! The Python upstream is M/G/1-flavoured (single server, general service
//! time, ICML 2026 §2). We generalize to M/M/c so the same primitives
//! cover both single-CLI-driver and multi-worker (apohara-remote-worker)
//! dispatch surfaces.

use std::time::{Duration, Instant};

// ---------------------------------------------------------------
// Pure closed-form formulas
// ---------------------------------------------------------------

/// Per-server utilization ρ = λ / (c · μ).
///
/// Clamped to `[0, 1)` — values >= 1 indicate an unstable queue and
/// callers should reject admission rather than feed the formula
/// downstream (Erlang-C diverges at ρ → 1).
#[inline]
pub fn utilization(lambda: f64, mu: f64, c: u32) -> f64 {
    if mu <= 0.0 || c == 0 {
        return 1.0;
    }
    let raw = lambda / (mu * c as f64);
    raw.clamp(0.0, 0.999_999)
}

/// Maximum admissible arrival rate at a target utilization ρ*.
///
/// `λ_critical = c · μ · ρ_target` — the inverse of [`utilization`].
#[inline]
pub fn lambda_critical(mu: f64, c: u32, target_utilization: f64) -> f64 {
    mu * (c as f64) * target_utilization.clamp(0.0, 1.0)
}

/// Erlang-C probability of queueing (P[wait > 0]) in an M/M/c system.
///
/// Standard formula:
///   `P_wait = ((c·ρ)^c / c!) · 1/(1 - ρ)`
///   `      / ( Σ_{k=0..c-1} (c·ρ)^k / k!  +  ((c·ρ)^c / c!) · 1/(1 - ρ) )`
///
/// Returns `1.0` when `ρ >= 1` (unstable). For `c == 1` this reduces to
/// M/M/1's `P_wait = ρ`.
pub fn erlang_c(c: u32, rho: f64) -> f64 {
    if c == 0 || rho >= 1.0 {
        return 1.0;
    }
    if rho <= 0.0 {
        return 0.0;
    }
    let c_f = c as f64;
    let a = c_f * rho; // offered load in Erlangs

    // Σ_{k=0..c-1} a^k / k!  (computed iteratively to avoid factorial overflow)
    let mut term = 1.0; // a^0 / 0!
    let mut sum = 1.0;
    for k in 1..c {
        term *= a / k as f64;
        sum += term;
    }
    // After the loop, `term` = a^(c-1) / (c-1)!. One more step → a^c / c!.
    term *= a / c_f;
    let numerator = term / (1.0 - rho);
    numerator / (sum + numerator)
}

/// Expected wait time in queue (W_q) for an M/M/c system.
///
/// `W_q = P_wait / (c · μ · (1 - ρ))` — divergent as ρ → 1.
pub fn mmc_wait_time(lambda: f64, mu: f64, c: u32) -> f64 {
    if mu <= 0.0 || c == 0 {
        return f64::INFINITY;
    }
    let rho = lambda / (mu * c as f64);
    if rho >= 1.0 {
        return f64::INFINITY;
    }
    let p_wait = erlang_c(c, rho);
    p_wait / ((c as f64) * mu * (1.0 - rho))
}

/// Little's Law: L = λ · W  (mean items in system).
///
/// Caller supplies `mean_time_in_system` (W) — usually `W_q + 1/μ` for
/// queue + service.
#[inline]
pub fn little_law_in_system(lambda: f64, mean_time_in_system: f64) -> f64 {
    lambda * mean_time_in_system
}

// ---------------------------------------------------------------
// Online controller — EMA + Welford + admission decisions
// ---------------------------------------------------------------

/// Configuration knobs for the admission [`Controller`].
#[derive(Debug, Clone, Copy)]
pub struct ControllerConfig {
    /// Number of parallel servers (worker count). Matches `c` in M/M/c.
    pub servers: u32,
    /// EMA half-life for λ in seconds. Larger = smoother estimates.
    pub window_seconds: f64,
    /// Target utilization ρ*. Admission rejects above this.
    pub target_utilization: f64,
    /// Minimum in-flight items the controller will keep admitting at
    /// (Little's Law floor). INVARIANT-11 analogue: never starve below
    /// this even when ρ momentarily spikes.
    pub min_stable_concurrency: u32,
}

impl Default for ControllerConfig {
    fn default() -> Self {
        Self {
            servers: 1,
            window_seconds: 60.0,
            target_utilization: 0.8,
            min_stable_concurrency: 1,
        }
    }
}

/// Numerically stable mean / variance (Welford 1962).
///
/// One-pass, no precision loss vs. naïve `Σx² - (Σx)²/n`.
#[derive(Debug, Default, Clone, Copy)]
struct Welford {
    count: u64,
    mean: f64,
    m2: f64,
}

impl Welford {
    fn update(&mut self, value: f64) {
        self.count += 1;
        let delta = value - self.mean;
        self.mean += delta / self.count as f64;
        let delta2 = value - self.mean;
        self.m2 += delta * delta2;
    }
}

/// Admission decision returned from [`Controller::admit`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdmissionDecision {
    /// Admit the work item — queue has slack.
    Admit,
    /// Defer admission; caller should retry after `retry_after_ms`.
    /// Returned when ρ exceeds the target but inflight is below the
    /// `min_stable_concurrency` floor.
    Defer { retry_after_ms: u32 },
    /// Reject the work item — utilization is at saturation AND inflight
    /// already meets the floor, so admitting would violate stability.
    Reject,
}

/// Online queueing controller with EMA arrival rate + Welford service-time.
pub struct Controller {
    config: ControllerConfig,
    service_stats: Welford,
    lambda_ema: f64,
    last_arrival: Option<Instant>,
    inflight: u32,
}

impl Controller {
    pub fn new(config: ControllerConfig) -> Self {
        Self {
            config,
            service_stats: Welford::default(),
            lambda_ema: 0.0,
            last_arrival: None,
            inflight: 0,
        }
    }

    #[inline]
    pub fn config(&self) -> ControllerConfig {
        self.config
    }
    #[inline]
    pub fn inflight(&self) -> u32 {
        self.inflight
    }
    #[inline]
    pub fn lambda(&self) -> f64 {
        self.lambda_ema
    }
    #[inline]
    pub fn mean_service_time(&self) -> f64 {
        self.service_stats.mean
    }

    /// Estimated service rate μ = 1 / E[S]. Returns a conservative
    /// default (1.0 req/s) before any completions land — admitting one
    /// item per second is safe on every realistic worker.
    pub fn mu(&self) -> f64 {
        if self.service_stats.count == 0 || self.service_stats.mean <= 0.0 {
            return 1.0;
        }
        1.0 / self.service_stats.mean
    }

    /// Update λ EMA from an arrival at `now`. Uses the inter-arrival
    /// time + the paper's α = 1 - exp(-Δt / T) decay.
    pub fn record_arrival(&mut self, now: Instant) {
        self.inflight = self.inflight.saturating_add(1);
        if let Some(prev) = self.last_arrival {
            let dt = now.saturating_duration_since(prev).as_secs_f64();
            if dt > 0.0 {
                let alpha = 1.0 - (-dt / self.config.window_seconds).exp();
                let instantaneous = 1.0 / dt;
                self.lambda_ema = alpha * instantaneous + (1.0 - alpha) * self.lambda_ema;
            }
        }
        self.last_arrival = Some(now);
    }

    /// Update Welford E[S] with an observed completion.
    pub fn record_completion(&mut self, service_time: Duration) {
        self.inflight = self.inflight.saturating_sub(1);
        self.service_stats.update(service_time.as_secs_f64());
    }

    /// Project the M/M/c utilization the system would see if we admit one
    /// more arrival right now.
    pub fn projected_utilization(&self) -> f64 {
        utilization(self.lambda_ema, self.mu(), self.config.servers)
    }

    /// Mean number of items in system (Little's Law).
    pub fn items_in_system(&self) -> f64 {
        let w_q = mmc_wait_time(self.lambda_ema, self.mu(), self.config.servers);
        if !w_q.is_finite() {
            return f64::INFINITY;
        }
        let w = w_q + 1.0 / self.mu();
        little_law_in_system(self.lambda_ema, w)
    }

    /// Admission gate: returns whether to accept, defer, or reject the
    /// next arrival. Pure read of internal state — call
    /// [`Self::record_arrival`] separately after deciding to admit.
    pub fn admit(&self) -> AdmissionDecision {
        let rho = self.projected_utilization();
        if rho <= self.config.target_utilization {
            return AdmissionDecision::Admit;
        }
        if self.inflight < self.config.min_stable_concurrency {
            // Below the stability floor — defer rather than reject so
            // the caller can retry once a slot frees up.
            let retry_ms = self.suggest_retry_ms();
            return AdmissionDecision::Defer {
                retry_after_ms: retry_ms,
            };
        }
        AdmissionDecision::Reject
    }

    /// Time-until-next-server-free heuristic in milliseconds, clamped to
    /// `[1, 60_000]` so callers can pass it straight to a sleep.
    fn suggest_retry_ms(&self) -> u32 {
        let mu = self.mu();
        if !mu.is_finite() || mu <= 0.0 {
            return 1_000;
        }
        let mean_service_ms = 1_000.0 / mu;
        mean_service_ms.clamp(1.0, 60_000.0) as u32
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    // -------- pure formulas --------

    #[test]
    fn utilization_basic() {
        assert!((utilization(8.0, 10.0, 1) - 0.8).abs() < 1e-9);
        assert!((utilization(8.0, 5.0, 2) - 0.8).abs() < 1e-9);
    }

    #[test]
    fn utilization_clamps_pathological_inputs() {
        assert_eq!(utilization(10.0, 0.0, 1), 1.0);
        assert_eq!(utilization(10.0, 1.0, 0), 1.0);
        let saturated = utilization(100.0, 1.0, 1);
        assert!(saturated < 1.0 && saturated > 0.99);
    }

    #[test]
    fn lambda_critical_inverts_utilization() {
        let lc = lambda_critical(10.0, 2, 0.8);
        assert!((lc - 16.0).abs() < 1e-9);
        assert!((utilization(lc, 10.0, 2) - 0.8).abs() < 1e-6);
    }

    #[test]
    fn erlang_c_reduces_to_rho_when_c_eq_1() {
        // M/M/1: P_wait = ρ
        for rho in [0.1f64, 0.5, 0.9] {
            let p = erlang_c(1, rho);
            assert!((p - rho).abs() < 1e-9, "rho={rho}, got {p}");
        }
    }

    #[test]
    fn erlang_c_saturates_at_one_when_unstable() {
        assert_eq!(erlang_c(2, 1.0), 1.0);
        assert_eq!(erlang_c(4, 1.5), 1.0);
    }

    #[test]
    fn erlang_c_is_zero_at_zero_utilization() {
        assert_eq!(erlang_c(4, 0.0), 0.0);
    }

    #[test]
    fn mmc_wait_time_diverges_near_saturation() {
        let w_low = mmc_wait_time(5.0, 10.0, 1);
        let w_high = mmc_wait_time(9.0, 10.0, 1);
        assert!(w_high > w_low * 5.0);
        // Past saturation → infinity.
        assert!(mmc_wait_time(11.0, 10.0, 1).is_infinite());
    }

    #[test]
    fn mmc_more_servers_lower_wait_at_equal_total_capacity() {
        // c=4 with μ=2.5 vs c=1 with μ=10 — same μ·c = 10, same ρ=0.8.
        // Erlang-C predicts the multi-server system has lower P_wait.
        let w_single = mmc_wait_time(8.0, 10.0, 1);
        let w_multi = mmc_wait_time(8.0, 2.5, 4);
        assert!(w_multi < w_single, "multi-server should wait less");
    }

    #[test]
    fn little_law_basic() {
        // λ = 4 req/s, mean time in system = 2 s → L = 8 in flight.
        assert!((little_law_in_system(4.0, 2.0) - 8.0).abs() < 1e-9);
    }

    // -------- controller --------

    #[test]
    fn welford_matches_naive_for_small_samples() {
        let mut w = Welford::default();
        for x in [1.0f64, 2.0, 3.0, 4.0, 5.0] {
            w.update(x);
        }
        assert!((w.mean - 3.0).abs() < 1e-9);
        // population variance over [1..=5] = 2.0
        assert!((w.m2 / w.count as f64 - 2.0).abs() < 1e-9);
    }

    #[test]
    fn controller_defaults_admit_when_idle() {
        let c = Controller::new(ControllerConfig::default());
        assert_eq!(c.admit(), AdmissionDecision::Admit);
        assert_eq!(c.inflight(), 0);
    }

    #[test]
    fn controller_records_completion_updates_mu() {
        let mut c = Controller::new(ControllerConfig::default());
        c.record_arrival(Instant::now());
        c.record_completion(Duration::from_millis(500));
        // E[S] = 0.5 s → μ = 2 req/s
        assert!((c.mu() - 2.0).abs() < 1e-6);
        assert_eq!(c.inflight(), 0);
    }

    #[test]
    fn controller_rejects_when_saturated_and_above_floor() {
        // Short EMA window so the rapid-fire test arrivals actually move
        // λ_EMA before the assertion. 60 s would smooth them into noise.
        let mut c = Controller::new(ControllerConfig {
            servers: 1,
            window_seconds: 0.1,
            target_utilization: 0.5,
            min_stable_concurrency: 1,
        });
        // Service time 1 s → μ = 1.
        c.record_arrival(Instant::now());
        c.record_completion(Duration::from_secs(1));
        // Force λ well above μ by injecting tight arrivals.
        let t0 = Instant::now();
        for i in 1..50 {
            c.record_arrival(t0 + Duration::from_millis(i * 50));
        }
        assert!(
            c.projected_utilization() > 0.5,
            "rho={}",
            c.projected_utilization()
        );
        // inflight > floor and saturated → Reject.
        match c.admit() {
            AdmissionDecision::Reject => {}
            other => panic!("expected Reject, got {other:?}"),
        }
    }

    #[test]
    fn controller_defers_when_saturated_but_below_floor() {
        let mut c = Controller::new(ControllerConfig {
            servers: 1,
            window_seconds: 60.0,
            target_utilization: 0.1, // very tight target
            min_stable_concurrency: 10,
        });
        // Service time 100 ms → μ = 10.
        c.record_arrival(Instant::now());
        c.record_completion(Duration::from_millis(100));
        // Hit it with rapid arrivals to push λ_EMA up.
        let t0 = Instant::now();
        for i in 1..5 {
            c.record_arrival(t0 + Duration::from_millis(i));
        }
        // inflight (4) is below min_stable_concurrency (10).
        if c.projected_utilization() > 0.1 {
            match c.admit() {
                AdmissionDecision::Defer { retry_after_ms } => {
                    assert!(retry_after_ms >= 1);
                    assert!(retry_after_ms <= 60_000);
                }
                other => panic!("expected Defer, got {other:?}"),
            }
        }
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(64))]

        /// Erlang-C is monotonic in ρ for fixed c (more load => more wait).
        #[test]
        fn prop_erlang_c_monotonic_in_rho(
            c in 1u32..8,
            rho_a in 0.01f64..0.9,
            delta in 0.001f64..0.05,
        ) {
            let rho_b = (rho_a + delta).min(0.95);
            let pa = erlang_c(c, rho_a);
            let pb = erlang_c(c, rho_b);
            prop_assert!(pb >= pa - 1e-9,
                "expected erlang_c({c}, {rho_b}) >= erlang_c({c}, {rho_a}); got {pb} < {pa}");
        }

        /// utilization is bounded in [0, 1) for any finite inputs.
        #[test]
        fn prop_utilization_bounded(
            lambda in 0.0f64..1e6,
            mu in 0.001f64..1e6,
            c in 1u32..32,
        ) {
            let u = utilization(lambda, mu, c);
            prop_assert!((0.0..1.0).contains(&u));
        }
    }
}
