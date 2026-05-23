//! Permission decision engine — ports `src/core/safety/permissionService.ts`.
//!
//! Decision order (deny-first wins):
//!   1. settings.deny    — explicit blocks ALWAYS win, even over a cached allow.
//!   2. auto-approval    — heuristic safe-list short-circuits without prompt.
//!   3. cache            — session-scoped user approvals (scope=session).
//!   4. settings.allow   — merged tier; skipped for compound bash (INV-bash-scope).
//!   5. otherwise: ask   — suggested pattern + available scopes.
//!
//! Compound bash special case: when the command is detected as compound,
//! `available_scopes` is clamped to `[Once]` only and `settings.allow` is
//! skipped, so `git status && rm -rf /` cannot inherit a `Bash(git:*)`
//! always-scope approval.

use crate::auto_approval::{classify_tool_for_auto_approval, AutoApprovalDecision};
use crate::bash_compound::split_compound;
use crate::patterns::{match_pattern, parse_pattern_string, ToolInvocation};
use crate::permission_cache::PermissionCache;
use crate::permission_grid::PermissionScope;
use crate::settings_hierarchy::MergedSettings;
use serde::{Deserialize, Serialize};
use url::Url;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PermissionDecision {
    Allow {
        reason: AllowReason,
    },
    Deny {
        reason: DenyReason,
    },
    Ask {
        suggested_pattern: String,
        available_scopes: Vec<PermissionScope>,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AllowReason {
    Cached,
    SettingsAllow,
    AutoApproved,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DenyReason {
    SettingsDeny,
    CompoundUnsafe,
}

pub struct PermissionServiceOpts<'a> {
    pub cache: &'a PermissionCache,
    pub settings: &'a MergedSettings,
}

pub fn check(
    session_id: &str,
    inv: &ToolInvocation,
    opts: PermissionServiceOpts<'_>,
) -> PermissionDecision {
    // 0. Compound bash guard (INV-bash-scope): always redirect to ask with [Once].
    //    Must be checked BEFORE allow-list to prevent "always" scope leak.
    let mut scopes = vec![
        PermissionScope::Once,
        PermissionScope::Session,
        PermissionScope::Always,
    ];
    let mut is_compound = false;
    if inv.tool == "Bash" {
        if let Some(cmd) = inv.input.get("command").and_then(|v| v.as_str()) {
            if split_compound(cmd).len() > 1 {
                scopes = vec![PermissionScope::Once];
                is_compound = true;
            }
        }
    }

    // 1. Deny first — absolute veto.
    for deny_str in &opts.settings.deny {
        if let Some(p) = parse_pattern_string(deny_str) {
            if match_pattern(&p, inv) {
                return PermissionDecision::Deny {
                    reason: DenyReason::SettingsDeny,
                };
            }
        }
    }

    // 2. Auto-approval (runs AFTER deny so explicit user veto still wins).
    if let AutoApprovalDecision::Allow { .. } = classify_tool_for_auto_approval(inv) {
        return PermissionDecision::Allow {
            reason: AllowReason::AutoApproved,
        };
    }

    // 3. Session cache (scope=session approvals).
    for cached in opts.cache.list(session_id) {
        if let Some(p) = parse_pattern_string(&cached) {
            if match_pattern(&p, inv) {
                return PermissionDecision::Allow {
                    reason: AllowReason::Cached,
                };
            }
        }
    }

    // 4. Settings allow (skipped for compound — INV-bash-scope).
    if !is_compound {
        for allow_str in &opts.settings.allow {
            if let Some(p) = parse_pattern_string(allow_str) {
                if match_pattern(&p, inv) {
                    return PermissionDecision::Allow {
                        reason: AllowReason::SettingsAllow,
                    };
                }
            }
        }
    }

    PermissionDecision::Ask {
        suggested_pattern: suggest_pattern(inv),
        available_scopes: scopes,
    }
}

fn suggest_pattern(inv: &ToolInvocation) -> String {
    if inv.tool == "Bash" {
        if let Some(cmd) = inv.input.get("command").and_then(|v| v.as_str()) {
            let first = cmd.split_whitespace().next().unwrap_or("");
            return format!("Bash({first}:*)");
        }
    }
    if inv.tool == "Edit" {
        if let Some(file) = inv.input.get("file_path").and_then(|v| v.as_str()) {
            return format!("Edit({file})");
        }
    }
    if inv.tool == "WebFetch" {
        if let Some(u) = inv.input.get("url").and_then(|v| v.as_str()) {
            return match Url::parse(u).ok().and_then(|p| p.host_str().map(|s| s.to_string())) {
                Some(host) => format!("WebFetch(domain:{host})"),
                None => "WebFetch(*)".to_string(),
            };
        }
    }
    inv.tool.clone()
}
