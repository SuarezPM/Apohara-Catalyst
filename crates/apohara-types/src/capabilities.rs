//! Provider capability flags per spec §4.5.1.
//!
//! Each provider declares which capabilities it supports. UI consults
//! `provider.capabilities()` to show/hide features. Backend uses
//! capability gating to skip flows the provider can't participate in.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Capability {
    // Session control
    SessionFork,
    SessionResume,
    SetupHelper,

    // Context
    ContextUsage,
    CompactBoundary,

    // Tools
    NativeMcpTools,
    SlashCommands,
    BashTool,
    EditTool,
    ReadTool,

    // Communication
    JsonStream,
    StderrStructured,
    OscTitleUpdates,

    // Workflows
    AskUserQuestion,
    PermissionRequest,

    // Apohara-specific
    AgentHooks,
    RosterHardening,
    DriftDetection,
    SandboxAware,
}

impl Capability {
    pub fn all() -> &'static [Capability] {
        &[
            Capability::SessionFork,
            Capability::SessionResume,
            Capability::SetupHelper,
            Capability::ContextUsage,
            Capability::CompactBoundary,
            Capability::NativeMcpTools,
            Capability::SlashCommands,
            Capability::BashTool,
            Capability::EditTool,
            Capability::ReadTool,
            Capability::JsonStream,
            Capability::StderrStructured,
            Capability::OscTitleUpdates,
            Capability::AskUserQuestion,
            Capability::PermissionRequest,
            Capability::AgentHooks,
            Capability::RosterHardening,
            Capability::DriftDetection,
            Capability::SandboxAware,
        ]
    }
}
