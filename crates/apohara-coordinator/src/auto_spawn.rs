//! Auto-spawn integration (G6.D.5).
//!
//! Smart router decides what a prompt means (G6.D.2). Repeat-intent
//! detector (G6.D.4) fires when the same intent shows up 3× within 5
//! minutes. This module is the bridge: it receives the repeat-intent
//! event and decides which provider should be auto-spawned to handle
//! the run.
//!
//! Gated by `APOHARA_SMART_ROUTER=1` AND a per-intent allow-list.
//! When off, the recommendation is "no auto-spawn — let the operator
//! pick". When on, the default mapping is the one in
//! `apohara_types::intent::default_provider_for`.

use std::collections::HashMap;

use apohara_types::intent::{default_provider_for, Intent};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AutoSpawnDecision {
    /// Smart router is disabled — pick provider manually.
    Disabled,
    /// Spawn this provider for the upcoming run.
    Spawn { provider_id: String, intent: Intent },
    /// Operator has blocked auto-spawn for this intent — explicit selection required.
    Blocked { intent: Intent, reason: String },
}

#[derive(Debug, Clone)]
pub struct AutoSpawnPolicy {
    pub enabled: bool,
    /// Intent → provider override (per-workspace config). If absent, falls
    /// back to `default_provider_for`.
    pub overrides: HashMap<Intent, String>,
    /// Intents the operator has explicitly blocked from auto-spawn
    /// (e.g. "Review" — they always want to drive it themselves).
    pub blocked: Vec<Intent>,
}

impl AutoSpawnPolicy {
    pub fn from_env(env: &HashMap<String, String>) -> Self {
        Self {
            enabled: env.get("APOHARA_SMART_ROUTER").map(|v| v == "1").unwrap_or(false),
            overrides: HashMap::new(),
            blocked: Vec::new(),
        }
    }

    pub fn disabled() -> Self {
        Self {
            enabled: false,
            overrides: HashMap::new(),
            blocked: Vec::new(),
        }
    }

    pub fn enabled_default() -> Self {
        Self {
            enabled: true,
            overrides: HashMap::new(),
            blocked: Vec::new(),
        }
    }

    pub fn with_override(mut self, intent: Intent, provider_id: impl Into<String>) -> Self {
        self.overrides.insert(intent, provider_id.into());
        self
    }

    pub fn block(mut self, intent: Intent) -> Self {
        self.blocked.push(intent);
        self
    }
}

/// Pure decision function — no IO, no global state. Caller passes the
/// repeat-intent event and the current policy; this returns the
/// scheduler-actionable decision.
pub fn decide_auto_spawn(intent: Intent, policy: &AutoSpawnPolicy) -> AutoSpawnDecision {
    if !policy.enabled {
        return AutoSpawnDecision::Disabled;
    }
    if policy.blocked.contains(&intent) {
        return AutoSpawnDecision::Blocked {
            intent,
            reason: "intent in operator block-list".to_string(),
        };
    }
    let provider_id = policy
        .overrides
        .get(&intent)
        .cloned()
        .unwrap_or_else(|| default_provider_for(intent).to_string());
    AutoSpawnDecision::Spawn { provider_id, intent }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disabled_when_policy_off() {
        let p = AutoSpawnPolicy::disabled();
        assert_eq!(decide_auto_spawn(Intent::Implement, &p), AutoSpawnDecision::Disabled);
    }

    #[test]
    fn enabled_uses_default_mapping() {
        let p = AutoSpawnPolicy::enabled_default();
        let d = decide_auto_spawn(Intent::Implement, &p);
        assert_eq!(
            d,
            AutoSpawnDecision::Spawn {
                provider_id: "claude-code-cli".to_string(),
                intent: Intent::Implement,
            }
        );
    }

    #[test]
    fn override_wins_over_default() {
        let p = AutoSpawnPolicy::enabled_default().with_override(Intent::Refactor, "claude-code-cli");
        let d = decide_auto_spawn(Intent::Refactor, &p);
        assert_eq!(
            d,
            AutoSpawnDecision::Spawn {
                provider_id: "claude-code-cli".to_string(),
                intent: Intent::Refactor,
            }
        );
    }

    #[test]
    fn block_list_emits_blocked() {
        let p = AutoSpawnPolicy::enabled_default().block(Intent::Review);
        match decide_auto_spawn(Intent::Review, &p) {
            AutoSpawnDecision::Blocked { intent, .. } => assert_eq!(intent, Intent::Review),
            other => panic!("expected Blocked, got {:?}", other),
        }
    }

    #[test]
    fn env_factory_picks_up_smart_router_flag() {
        let mut env = HashMap::new();
        env.insert("APOHARA_SMART_ROUTER".to_string(), "1".to_string());
        let p = AutoSpawnPolicy::from_env(&env);
        assert!(p.enabled);

        let mut env2 = HashMap::new();
        env2.insert("APOHARA_SMART_ROUTER".to_string(), "0".to_string());
        let p2 = AutoSpawnPolicy::from_env(&env2);
        assert!(!p2.enabled);

        let p3 = AutoSpawnPolicy::from_env(&HashMap::new());
        assert!(!p3.enabled);
    }

    #[test]
    fn default_mapping_covers_all_intents() {
        let p = AutoSpawnPolicy::enabled_default();
        for i in Intent::all() {
            match decide_auto_spawn(*i, &p) {
                AutoSpawnDecision::Spawn { provider_id, .. } => {
                    let allowed = ["claude-code-cli", "codex-cli", "opencode-go"];
                    assert!(
                        allowed.contains(&provider_id.as_str()),
                        "intent {:?} mapped to non-active-roster provider {}",
                        i,
                        provider_id
                    );
                }
                other => panic!("expected Spawn for intent {:?}, got {:?}", i, other),
            }
        }
    }
}
