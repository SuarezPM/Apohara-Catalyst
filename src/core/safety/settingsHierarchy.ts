/** 3-tier settings hierarchy per spec §4.6. */

export interface SettingsTier {
  source: "user_global" | "project_shared" | "project_local";
  patterns: string[];
  deny: string[];
}

export interface MergedSettings {
  allow: string[];
  deny: string[];
}

export function mergeSettingsTiers(tiers: SettingsTier[]): MergedSettings {
  const allow = new Set<string>();
  const deny = new Set<string>();
  for (const t of tiers) {
    for (const p of t.patterns) allow.add(p);
    for (const p of t.deny) deny.add(p);
  }
  return { allow: Array.from(allow), deny: Array.from(deny) };
}