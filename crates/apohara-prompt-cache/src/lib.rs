//! Apohara Prompt Cache — HOT (DashMap) + WARM (SQLite WAL) tiers + 3 layers safety.
//!
//! Feature flag: `APOHARA_PROMPT_CACHE=1` (default OFF until self-tuning
//! telemetry lands in Phase 4).
//!
//! 3 layers safety:
//!   * L1 — cache key scoping by `(provider_id, model_id, prompt_fingerprint)`.
//!   * L2 — confidence threshold via hamming-distance ladder buckets
//!     (0 / 1-3 / 4-7 / 8-15 / 16+) with per-bucket gates.
//!   * L3 — opt-in via `APOHARA_PROMPT_CACHE=1` env var + read-only
//!     telemetry hooks (self-tuning deferred to Phase 4).
//!
//! G3.B.2 — ported task-by-task following TDD.

pub mod key;
