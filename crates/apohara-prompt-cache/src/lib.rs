//! Apohara Prompt Cache — HOT (DashMap) + WARM (SQLite WAL) tiers + 3 layers safety.
//!
//! Feature flag: APOHARA_PROMPT_CACHE=1 (default OFF until self-tuning telemetry lands).
//!
//! 3 layers safety:
//!   L1 — cache key scoping by (provider_id, model_id)
//!   L2 — confidence threshold via hamming-distance ladder
//!   L3 — opt-in flag + telemetry self-tuning
//!
//! G3.B.2 skeleton — modules ported task-by-task following TDD.
