//! Ports `src/core/safety/runnerPolicy/presets.ts`. Same regex strings,
//! same preset shapes.

use super::types::*;

/// Regex patterns for catastrophically destructive commands. The naive
/// `^rm\\s+-rf\\s+/$` only blocked the literal — this set adds flag
/// re-orderings, explicit overrides, dd/mkfs/wipefs/shred against block
/// devices, the classic fork-bomb, and shutdown/reboot/halt/poweroff.
pub fn destructive_core() -> Vec<String> {
    vec![
        // rm with any combination of recursive + force + root target
        r"^rm\s+(--recursive\s+--force|--force\s+--recursive|-[a-zA-Z]*[rR][a-zA-Z]*[fF][a-zA-Z]*|-[a-zA-Z]*[fF][a-zA-Z]*[rR][a-zA-Z]*)\s+(--no-preserve-root\s+)?/+(\s|$)".to_string(),
        // dd to raw block device
        r"^dd\s+.*of=/dev/(sd|nvme|hd|vd|xvd|loop|mmcblk)".to_string(),
        // mkfs* on a block device
        r"^mkfs(\.\w+)?\s+.*/dev/".to_string(),
        r"^wipefs\s+".to_string(),
        // shred a block device
        r"^shred\s+.*/dev/".to_string(),
        // Power state
        r"^(shutdown|poweroff|halt|reboot)\b".to_string(),
        // Classic fork-bomb
        r":\(\)\s*\{\s*:\|:&\s*\}\s*;\s*:".to_string(),
    ]
}

pub fn pipe_to_shell() -> Vec<String> {
    vec![r"(curl|wget|fetch)\s+[^|]*\|\s*(sudo\s+)?(sh|bash|zsh|fish|dash|ksh)\b".to_string()]
}

pub const SUDO_BARE: &str = r"^sudo\s+";

pub fn strict() -> RunnerExecutionPolicy {
    let mut blocked = destructive_core();
    blocked.extend(pipe_to_shell());
    blocked.push(SUDO_BARE.to_string());
    RunnerExecutionPolicy {
        preset: PolicyPreset::Strict,
        filesystem: FilesystemPolicy {
            protected_paths: vec![
                "AGENTS.md".to_string(),
                "CLAUDE.md".to_string(),
                ".apohara/**".to_string(),
                ".env*".to_string(),
            ],
            readonly_paths: vec!["docs/superpowers/specs/**".to_string()],
            writable_scope: WritableScope::Workspace,
        },
        network: NetworkPolicy {
            allowed_domains: vec![
                "github.com".to_string(),
                "npmjs.org".to_string(),
                "crates.io".to_string(),
                "docs.rs".to_string(),
            ],
            blocked_domains: vec![],
            default_action: NetworkDefault::Deny,
        },
        credentials: CredentialsPolicy {
            scan_for_leaks: true,
            block_on_suspected_leak: true,
        },
        publish: PublishPolicy {
            block_push_to_main: true,
            block_force_push: true,
            require_signed_commits: false,
        },
        commands: CommandsPolicy {
            blocked,
            warn_only: vec![],
        },
        external_sandbox: ExternalSandboxPolicy {
            enabled: false,
            tool: None,
        },
    }
}

pub fn balanced() -> RunnerExecutionPolicy {
    let mut blocked = destructive_core();
    blocked.extend(pipe_to_shell());
    RunnerExecutionPolicy {
        preset: PolicyPreset::Balanced,
        filesystem: FilesystemPolicy {
            protected_paths: vec![
                "AGENTS.md".to_string(),
                "CLAUDE.md".to_string(),
                ".env*".to_string(),
            ],
            readonly_paths: vec![],
            writable_scope: WritableScope::Workspace,
        },
        network: NetworkPolicy {
            allowed_domains: vec![],
            blocked_domains: vec![],
            default_action: NetworkDefault::Allow,
        },
        credentials: CredentialsPolicy {
            scan_for_leaks: true,
            block_on_suspected_leak: false,
        },
        publish: PublishPolicy {
            block_push_to_main: true,
            block_force_push: false,
            require_signed_commits: false,
        },
        commands: CommandsPolicy {
            blocked,
            warn_only: vec![SUDO_BARE.to_string()],
        },
        external_sandbox: ExternalSandboxPolicy {
            enabled: false,
            tool: None,
        },
    }
}

pub fn advisory() -> RunnerExecutionPolicy {
    let mut warn_only = destructive_core();
    warn_only.extend(pipe_to_shell());
    warn_only.push(SUDO_BARE.to_string());
    RunnerExecutionPolicy {
        preset: PolicyPreset::Advisory,
        filesystem: FilesystemPolicy {
            protected_paths: vec![],
            readonly_paths: vec![],
            writable_scope: WritableScope::Anywhere,
        },
        network: NetworkPolicy {
            allowed_domains: vec![],
            blocked_domains: vec![],
            default_action: NetworkDefault::Allow,
        },
        credentials: CredentialsPolicy {
            scan_for_leaks: true,
            block_on_suspected_leak: false,
        },
        publish: PublishPolicy {
            block_push_to_main: false,
            block_force_push: false,
            require_signed_commits: false,
        },
        commands: CommandsPolicy {
            blocked: vec![],
            warn_only,
        },
        external_sandbox: ExternalSandboxPolicy {
            enabled: false,
            tool: None,
        },
    }
}

pub fn external_sandbox() -> RunnerExecutionPolicy {
    let mut p = strict();
    p.preset = PolicyPreset::ExternalSandbox;
    p.external_sandbox = ExternalSandboxPolicy {
        enabled: true,
        tool: Some(SandboxTool::Bwrap),
    };
    p
}
