use super::settings_hierarchy::{
    merge_settings_tiers, MergeOpts, SettingsSource, SettingsTier,
};

fn tier(source: SettingsSource, allow: &[&str], deny: &[&str]) -> SettingsTier {
    SettingsTier {
        source,
        patterns: allow.iter().map(|s| s.to_string()).collect(),
        deny: deny.iter().map(|s| s.to_string()).collect(),
    }
}

#[test]
fn user_global_always_contributes_allow() {
    let tiers = vec![tier(
        SettingsSource::UserGlobal,
        &["Bash(npm test:*)"],
        &[],
    )];
    let merged = merge_settings_tiers(&tiers, MergeOpts::default());
    assert_eq!(merged.allow, vec!["Bash(npm test:*)"]);
}

#[test]
fn untrusted_project_allow_is_ignored() {
    let tiers = vec![
        tier(SettingsSource::UserGlobal, &["Bash(npm test:*)"], &[]),
        tier(SettingsSource::ProjectShared, &["Bash(rm:*)"], &[]),
        tier(SettingsSource::ProjectLocal, &["Bash(curl:*)"], &[]),
    ];
    let merged = merge_settings_tiers(&tiers, MergeOpts::default());
    assert_eq!(merged.allow, vec!["Bash(npm test:*)"]);
}

#[test]
fn trusted_project_allow_is_merged() {
    let tiers = vec![
        tier(SettingsSource::UserGlobal, &["Bash(npm test:*)"], &[]),
        tier(SettingsSource::ProjectShared, &["Bash(cargo:*)"], &[]),
    ];
    let merged = merge_settings_tiers(&tiers, MergeOpts { trust_project: true });
    // BTreeSet ordering: Bash(cargo:*) < Bash(npm test:*)
    assert_eq!(
        merged.allow,
        vec!["Bash(cargo:*)".to_string(), "Bash(npm test:*)".to_string()]
    );
}

#[test]
fn deny_merges_from_every_tier_regardless_of_trust() {
    let tiers = vec![
        tier(SettingsSource::UserGlobal, &[], &["Bash(rm:*)"]),
        tier(SettingsSource::ProjectShared, &[], &["Bash(sudo:*)"]),
        tier(SettingsSource::ProjectLocal, &[], &["Bash(dd:*)"]),
    ];
    let merged = merge_settings_tiers(&tiers, MergeOpts::default());
    assert_eq!(
        merged.deny,
        vec![
            "Bash(dd:*)".to_string(),
            "Bash(rm:*)".to_string(),
            "Bash(sudo:*)".to_string(),
        ]
    );
}

#[test]
fn deduplicates_overlapping_patterns() {
    let tiers = vec![
        tier(SettingsSource::UserGlobal, &["Bash(git:*)"], &[]),
        tier(SettingsSource::UserGlobal, &["Bash(git:*)"], &[]),
    ];
    let merged = merge_settings_tiers(&tiers, MergeOpts::default());
    assert_eq!(merged.allow.len(), 1);
}
