//! Compiles a `RunnerExecutionPolicy` to an `ExecutionPlan` — ports
//! `src/core/safety/runnerPolicy/planCompiler.ts`.

use super::types::*;
use regex::Regex;
use std::sync::OnceLock;

pub fn compile_runner_execution_plan(policy: &RunnerExecutionPolicy) -> ExecutionPlan {
    let mut enforcement: Vec<Enforcement> = Vec::new();

    enforcement.push(Enforcement {
        area: EnforcementArea::Filesystem,
        strength: if !policy.filesystem.protected_paths.is_empty() {
            EnforcementStrength::Enforced
        } else {
            EnforcementStrength::Unsupported
        },
        critical: !policy.filesystem.protected_paths.is_empty(),
        description: Some(format!(
            "{} protected paths, scope: {}",
            policy.filesystem.protected_paths.len(),
            match policy.filesystem.writable_scope {
                WritableScope::Workspace => "workspace",
                WritableScope::Anywhere => "anywhere",
            }
        )),
    });

    enforcement.push(Enforcement {
        area: EnforcementArea::Network,
        strength: match policy.network.default_action {
            NetworkDefault::Deny => EnforcementStrength::Enforced,
            NetworkDefault::Allow => EnforcementStrength::Advisory,
        },
        critical: matches!(policy.network.default_action, NetworkDefault::Deny),
        description: Some(format!(
            "default: {}, allowed: {}",
            match policy.network.default_action {
                NetworkDefault::Allow => "allow",
                NetworkDefault::Deny => "deny",
            },
            policy.network.allowed_domains.len()
        )),
    });

    enforcement.push(Enforcement {
        area: EnforcementArea::Credentials,
        strength: if policy.credentials.block_on_suspected_leak {
            EnforcementStrength::Enforced
        } else {
            EnforcementStrength::Advisory
        },
        critical: policy.credentials.scan_for_leaks,
        description: Some(
            if policy.credentials.block_on_suspected_leak {
                "block on leak".to_string()
            } else {
                "scan only".to_string()
            },
        ),
    });

    enforcement.push(Enforcement {
        area: EnforcementArea::Publish,
        strength: if policy.publish.block_push_to_main {
            EnforcementStrength::Enforced
        } else {
            EnforcementStrength::Advisory
        },
        critical: policy.publish.block_push_to_main,
        description: Some(format!(
            "block-push-to-main: {}",
            policy.publish.block_push_to_main
        )),
    });

    enforcement.push(Enforcement {
        area: EnforcementArea::Commands,
        strength: if !policy.commands.blocked.is_empty() {
            EnforcementStrength::Enforced
        } else {
            EnforcementStrength::Advisory
        },
        critical: policy.commands.blocked.iter().any(|r| is_destructive_pattern(r)),
        description: Some(format!(
            "{} blocked, {} warn-only",
            policy.commands.blocked.len(),
            policy.commands.warn_only.len()
        )),
    });

    enforcement.push(Enforcement {
        area: EnforcementArea::ExternalSandbox,
        strength: if policy.external_sandbox.enabled {
            EnforcementStrength::Enforced
        } else {
            EnforcementStrength::Unsupported
        },
        critical: false,
        description: Some(match policy.external_sandbox.tool {
            Some(SandboxTool::Bwrap) => "bwrap".to_string(),
            Some(SandboxTool::Firejail) => "firejail".to_string(),
            None => "disabled".to_string(),
        }),
    });

    if matches!(policy.preset, PolicyPreset::Strict) {
        if let Some(violation) = enforcement.iter().find(|e| {
            e.critical
                && matches!(
                    e.strength,
                    EnforcementStrength::Partial | EnforcementStrength::Unsupported
                )
        }) {
            return ExecutionPlan {
                policy: policy.preset,
                rejection_reason: Some(format!(
                    "Strict mode rejects critical enforcement with strength {:?} for area {:?}",
                    violation.strength, violation.area
                )),
                enforcement,
                rejected: true,
            };
        }
    }

    ExecutionPlan {
        policy: policy.preset,
        enforcement,
        rejected: false,
        rejection_reason: None,
    }
}

fn is_destructive_pattern(r: &str) -> bool {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"rm\s+-rf|sudo").expect("static regex compiles"))
        .is_match(r)
}
