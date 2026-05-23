//! 3-tier settings hierarchy — ports `src/core/safety/settingsHierarchy.ts`.
//!
//! NOTE: the TS module also pulls the `loadConfigWithMigration` chain
//! from `core/config/versioning.ts`. That chain belongs to a different
//! crate (config versioning is workspace-wide, not safety-specific) and
//! will land separately; this port covers the merge logic, which is
//! what the permission service consumes.

use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SettingsSource {
    UserGlobal,
    ProjectShared,
    ProjectLocal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingsTier {
    pub source: SettingsSource,
    pub patterns: Vec<String>,
    pub deny: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct MergedSettings {
    pub allow: Vec<String>,
    pub deny: Vec<String>,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct MergeOpts {
    /// Whether the user has explicitly trusted this project. Default
    /// `false` so a hostile project cannot escalate permissions just by
    /// shipping its own `.claude/settings.json`. All tiers still
    /// contribute to `deny`.
    pub trust_project: bool,
}

pub fn merge_settings_tiers(tiers: &[SettingsTier], opts: MergeOpts) -> MergedSettings {
    // BTreeSet to keep the output deterministic across runs — TS's
    // `Set` iteration order is insertion order, but BTreeSet gives us
    // sort order which matters for snapshot tests and audit diffs.
    let mut allow: BTreeSet<String> = BTreeSet::new();
    let mut deny: BTreeSet<String> = BTreeSet::new();
    for t in tiers {
        let contributes_allow = matches!(t.source, SettingsSource::UserGlobal) || opts.trust_project;
        if contributes_allow {
            for p in &t.patterns {
                allow.insert(p.clone());
            }
        }
        for p in &t.deny {
            deny.insert(p.clone());
        }
    }
    MergedSettings {
        allow: allow.into_iter().collect(),
        deny: deny.into_iter().collect(),
    }
}
