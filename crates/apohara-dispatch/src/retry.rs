//! Retry semantics — backoff strategy per failure kind.
//! Ported from src/core/dispatch/retry-semantics.ts.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetryReason {
    Continuation,
    NetworkError,
    AuthExpired,
    Other,
    None,
}

const RETRY_CAP_MS: u64 = 5 * 60 * 1000;
const CONTINUATION_RETRY_MS: u64 = 1000;

pub fn compute_retry_delay(reason: RetryReason, attempt: u32) -> u64 {
    match reason {
        RetryReason::None => 0,
        RetryReason::Continuation => CONTINUATION_RETRY_MS,
        _ => {
            let base = 1000u64;
            base.checked_shl(attempt)
                .unwrap_or(RETRY_CAP_MS)
                .min(RETRY_CAP_MS)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn none_returns_zero() {
        assert_eq!(compute_retry_delay(RetryReason::None, 0), 0);
    }

    #[test]
    fn continuation_returns_1s() {
        assert_eq!(compute_retry_delay(RetryReason::Continuation, 0), 1000);
    }

    #[test]
    fn network_error_exponential_backoff_capped() {
        assert_eq!(compute_retry_delay(RetryReason::NetworkError, 0), 1000);
        assert_eq!(compute_retry_delay(RetryReason::NetworkError, 1), 2000);
        assert_eq!(compute_retry_delay(RetryReason::NetworkError, 2), 4000);
        assert_eq!(compute_retry_delay(RetryReason::NetworkError, 100), RETRY_CAP_MS);
    }

    #[test]
    fn auth_expired_uses_same_exponential() {
        assert_eq!(compute_retry_delay(RetryReason::AuthExpired, 3), 8000);
    }
}
