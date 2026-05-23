//! CLI driver — ports `src/providers/cli-driver.ts`. Filled in G1.A.3+.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DispatchRequest {}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DispatchOutcome {}

#[derive(Debug, Default)]
pub struct CliDriver;
