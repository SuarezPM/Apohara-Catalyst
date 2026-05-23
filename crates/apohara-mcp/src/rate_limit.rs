//! Per-server rate limiter (windowed token bucket).
//!
//! Mirrors `src/core/mcp/base/rateLimit.ts`. Default: 30 calls / minute,
//! 200 calls / hour. Windows are wall-clock minute / hour boundaries —
//! NOT sliding windows. Counters reset when the window flips. The
//! interface is sync (`try_consume` returns bool) because every caller
//! is on the request hot path; the underlying state lives inside a
//! `parking_lot`-free `std::sync::Mutex` we wrap in the server layer.

#[derive(Debug, Clone, Copy)]
pub struct RateLimitConfig {
    pub per_minute: u32,
    pub per_hour: u32,
}

pub const DEFAULT_RATE_LIMITS: RateLimitConfig = RateLimitConfig {
    per_minute: 30,
    per_hour: 200,
};

#[derive(Debug)]
pub struct TokenBucket {
    config: RateLimitConfig,
    minute_window: i64,
    minute_count: u32,
    hour_window: i64,
    hour_count: u32,
}

impl Default for TokenBucket {
    fn default() -> Self {
        Self::new(DEFAULT_RATE_LIMITS)
    }
}

impl TokenBucket {
    pub fn new(config: RateLimitConfig) -> Self {
        Self {
            config,
            minute_window: 0,
            minute_count: 0,
            hour_window: 0,
            hour_count: 0,
        }
    }

    /// `now_ms` is wall-clock ms since unix epoch. Returns true when the
    /// request fits inside both the per-minute and per-hour quotas;
    /// returns false (and does NOT increment counters) when either is
    /// saturated.
    pub fn try_consume(&mut self, now_ms: i64) -> bool {
        let current_minute = now_ms.div_euclid(60_000);
        let current_hour = now_ms.div_euclid(3_600_000);

        if current_minute != self.minute_window {
            self.minute_window = current_minute;
            self.minute_count = 0;
        }
        if current_hour != self.hour_window {
            self.hour_window = current_hour;
            self.hour_count = 0;
        }

        if self.minute_count >= self.config.per_minute {
            return false;
        }
        if self.hour_count >= self.config.per_hour {
            return false;
        }

        self.minute_count += 1;
        self.hour_count += 1;
        true
    }

    pub fn current_counts(&self, now_ms: i64) -> (u32, u32) {
        let current_minute = now_ms.div_euclid(60_000);
        let current_hour = now_ms.div_euclid(3_600_000);
        let minute = if current_minute == self.minute_window {
            self.minute_count
        } else {
            0
        };
        let hour = if current_hour == self.hour_window {
            self.hour_count
        } else {
            0
        };
        (minute, hour)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_within_minute_quota() {
        let mut b = TokenBucket::new(RateLimitConfig {
            per_minute: 3,
            per_hour: 100,
        });
        let t = 0;
        assert!(b.try_consume(t));
        assert!(b.try_consume(t));
        assert!(b.try_consume(t));
        assert!(!b.try_consume(t));
    }

    #[test]
    fn resets_on_minute_boundary() {
        let mut b = TokenBucket::new(RateLimitConfig {
            per_minute: 2,
            per_hour: 100,
        });
        let t = 0;
        assert!(b.try_consume(t));
        assert!(b.try_consume(t));
        assert!(!b.try_consume(t));
        // Cross to the next minute window
        let t2 = 60_000;
        assert!(b.try_consume(t2));
    }

    #[test]
    fn hour_quota_caps_under_minute_budget() {
        let mut b = TokenBucket::new(RateLimitConfig {
            per_minute: 100,
            per_hour: 5,
        });
        let t = 0;
        for _ in 0..5 {
            assert!(b.try_consume(t));
        }
        assert!(!b.try_consume(t));
    }

    #[test]
    fn current_counts_zero_after_window_flip() {
        let mut b = TokenBucket::new(DEFAULT_RATE_LIMITS);
        b.try_consume(0);
        b.try_consume(0);
        let (m, h) = b.current_counts(0);
        assert_eq!((m, h), (2, 2));
        // Jump 2h forward — both windows reset
        let later = 2 * 3_600_000;
        let (m2, h2) = b.current_counts(later);
        assert_eq!((m2, h2), (0, 0));
    }

    #[test]
    fn default_limits_match_ts_legacy() {
        // Sanity: TS legacy ships 30/min, 200/hour.
        assert_eq!(DEFAULT_RATE_LIMITS.per_minute, 30);
        assert_eq!(DEFAULT_RATE_LIMITS.per_hour, 200);
    }

    #[test]
    fn rejecting_does_not_increment() {
        let mut b = TokenBucket::new(RateLimitConfig {
            per_minute: 1,
            per_hour: 100,
        });
        let t = 0;
        assert!(b.try_consume(t));
        assert!(!b.try_consume(t));
        assert!(!b.try_consume(t));
        // Hour counter must NOT have ticked past 1 despite the two rejected calls.
        let (_, h) = b.current_counts(t);
        assert_eq!(h, 1);
    }
}
