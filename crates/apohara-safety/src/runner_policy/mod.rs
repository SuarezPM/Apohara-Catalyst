//! Runner policy — execution policy presets + compiler + fs snapshot.

pub mod fs_snapshot;
pub mod plan_compiler;
pub mod presets;
pub mod types;

pub use fs_snapshot::{detect_violations, snapshot_protected_paths, FileSnapshot, SnapshotResult, Violation};
pub use plan_compiler::compile_runner_execution_plan;
pub use presets::{advisory, balanced, external_sandbox, strict};
pub use types::*;
