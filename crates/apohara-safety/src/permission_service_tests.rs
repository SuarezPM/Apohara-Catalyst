use super::patterns::ToolInvocation;
use super::permission_cache::PermissionCache;
use super::permission_grid::PermissionScope;
use super::permission_service::{
    check, AllowReason, DenyReason, PermissionDecision, PermissionServiceOpts,
};
use super::settings_hierarchy::MergedSettings;
use serde_json::json;

fn bash(cmd: &str) -> ToolInvocation {
    ToolInvocation::new("Bash").with_input("command", json!(cmd))
}

#[test]
fn deny_wins_over_cached_allow() {
    let mut cache = PermissionCache::new();
    cache.add("s", "Bash(rm:*)");
    let settings = MergedSettings {
        allow: vec![],
        deny: vec!["Bash(rm:*)".to_string()],
    };
    let d = check(
        "s",
        &bash("rm tmp"),
        PermissionServiceOpts {
            cache: &cache,
            settings: &settings,
        },
    );
    assert_eq!(
        d,
        PermissionDecision::Deny {
            reason: DenyReason::SettingsDeny
        }
    );
}

#[test]
fn auto_approval_short_circuits_for_read_only() {
    let cache = PermissionCache::new();
    let settings = MergedSettings::default();
    let d = check(
        "s",
        &ToolInvocation::new("Read"),
        PermissionServiceOpts {
            cache: &cache,
            settings: &settings,
        },
    );
    assert_eq!(
        d,
        PermissionDecision::Allow {
            reason: AllowReason::AutoApproved
        }
    );
}

#[test]
fn cached_allow_wins_when_no_auto() {
    let mut cache = PermissionCache::new();
    cache.add("s", "Bash(yarn:*)");
    let settings = MergedSettings::default();
    let d = check(
        "s",
        &bash("yarn install"),
        PermissionServiceOpts {
            cache: &cache,
            settings: &settings,
        },
    );
    assert_eq!(
        d,
        PermissionDecision::Allow {
            reason: AllowReason::Cached
        }
    );
}

#[test]
fn settings_allow_grants_when_cache_empty() {
    let cache = PermissionCache::new();
    let settings = MergedSettings {
        allow: vec!["Bash(yarn:*)".to_string()],
        deny: vec![],
    };
    let d = check(
        "s",
        &bash("yarn install"),
        PermissionServiceOpts {
            cache: &cache,
            settings: &settings,
        },
    );
    assert_eq!(
        d,
        PermissionDecision::Allow {
            reason: AllowReason::SettingsAllow
        }
    );
}

#[test]
fn unknown_falls_through_to_ask() {
    let cache = PermissionCache::new();
    let settings = MergedSettings::default();
    let d = check(
        "s",
        &bash("yarn install"),
        PermissionServiceOpts {
            cache: &cache,
            settings: &settings,
        },
    );
    match d {
        PermissionDecision::Ask {
            suggested_pattern,
            available_scopes,
        } => {
            assert_eq!(suggested_pattern, "Bash(yarn:*)");
            assert_eq!(available_scopes.len(), 3);
        }
        other => panic!("expected ask, got {other:?}"),
    }
}

/// INV-bash-scope: compound bash with an ALLOWED prefix in settings
/// must NOT grant — instead it must fall through to ask with scopes
/// clamped to [Once] only.
#[test]
fn inv_bash_scope_compound_skips_settings_allow_and_clamps_scopes() {
    let cache = PermissionCache::new();
    let settings = MergedSettings {
        // Allow git always — yet the compound below must still ask.
        allow: vec!["Bash(git:*)".to_string()],
        deny: vec![],
    };
    let d = check(
        "s",
        &bash("git status && rm -rf /tmp/x"),
        PermissionServiceOpts {
            cache: &cache,
            settings: &settings,
        },
    );
    match d {
        PermissionDecision::Ask {
            available_scopes, ..
        } => {
            assert_eq!(
                available_scopes,
                vec![PermissionScope::Once],
                "INV-bash-scope: compound must clamp to Once-only"
            );
        }
        other => panic!("expected ask for compound, got {other:?}"),
    }
}

#[test]
fn suggest_pattern_extracts_webfetch_domain() {
    let cache = PermissionCache::new();
    let settings = MergedSettings::default();
    let inv = ToolInvocation::new("WebFetch").with_input("url", json!("https://api.github.com/x"));
    let d = check(
        "s",
        &inv,
        PermissionServiceOpts {
            cache: &cache,
            settings: &settings,
        },
    );
    match d {
        PermissionDecision::Ask {
            suggested_pattern, ..
        } => {
            assert_eq!(suggested_pattern, "WebFetch(domain:api.github.com)");
        }
        other => panic!("expected ask, got {other:?}"),
    }
}
