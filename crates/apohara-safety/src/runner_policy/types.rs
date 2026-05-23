//! Runner-policy domain types — ports `src/core/safety/runnerPolicy/types.ts`.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum PolicyPreset {
    Strict,
    Balanced,
    Advisory,
    ExternalSandbox,
    Custom,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum EnforcementStrength {
    Enforced,
    Partial,
    Advisory,
    Unsupported,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EnforcementArea {
    Filesystem,
    Network,
    Credentials,
    Publish,
    Commands,
    ExternalSandbox,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Enforcement {
    pub area: EnforcementArea,
    pub strength: EnforcementStrength,
    pub critical: bool,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WritableScope {
    Workspace,
    Anywhere,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilesystemPolicy {
    pub protected_paths: Vec<String>,
    pub readonly_paths: Vec<String>,
    pub writable_scope: WritableScope,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NetworkDefault {
    Allow,
    Deny,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkPolicy {
    pub allowed_domains: Vec<String>,
    pub blocked_domains: Vec<String>,
    pub default_action: NetworkDefault,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CredentialsPolicy {
    pub scan_for_leaks: bool,
    pub block_on_suspected_leak: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublishPolicy {
    pub block_push_to_main: bool,
    pub block_force_push: bool,
    pub require_signed_commits: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandsPolicy {
    pub blocked: Vec<String>,
    pub warn_only: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SandboxTool {
    Bwrap,
    Firejail,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExternalSandboxPolicy {
    pub enabled: bool,
    pub tool: Option<SandboxTool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunnerExecutionPolicy {
    pub preset: PolicyPreset,
    pub filesystem: FilesystemPolicy,
    pub network: NetworkPolicy,
    pub credentials: CredentialsPolicy,
    pub publish: PublishPolicy,
    pub commands: CommandsPolicy,
    pub external_sandbox: ExternalSandboxPolicy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionPlan {
    pub policy: PolicyPreset,
    pub enforcement: Vec<Enforcement>,
    pub rejected: bool,
    pub rejection_reason: Option<String>,
}
