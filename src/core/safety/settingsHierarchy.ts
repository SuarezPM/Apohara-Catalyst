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

export interface MergeOpts {
	/**
	 * Whether the user has explicitly trusted this project. When `false`
	 * (the default — safe for an unknown / freshly-cloned repo),
	 * `project_shared` and `project_local` patterns are IGNORED in the
	 * `allow` set: a hostile repo cannot escalate permissions just by
	 * shipping its own `.claude/settings.json`. All tiers still
	 * contribute to `deny` (any tier can lock something down).
	 *
	 * Callers wire this from the runtime trust check (e.g. presence of
	 * the workspace path in `~/.apohara/trusted-projects`).
	 */
	trustProject?: boolean;
}

export function mergeSettingsTiers(
	tiers: SettingsTier[],
	opts: MergeOpts = {},
): MergedSettings {
	const trustProject = opts.trustProject ?? false;
	const allow = new Set<string>();
	const deny = new Set<string>();
	for (const t of tiers) {
		const contributesAllow = t.source === "user_global" || trustProject;
		if (contributesAllow) {
			for (const p of t.patterns) allow.add(p);
		}
		for (const p of t.deny) deny.add(p);
	}
	return { allow: Array.from(allow), deny: Array.from(deny) };
}
