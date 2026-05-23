/**
 * Chorus /yolo (promoted to Ultimate, opt-in) — full-auto pipeline.
 * TRIPLE OFF by default: env var + UI toggle + per-workspace allowlist.
 * All three MUST be true to enable. Removing any one disables.
 *
 * Reason: agent rampage is a real risk. /yolo bypasses approvals and
 * auto-spawns decompose→dispatch→verify→commit→push→PR. Defense in
 * depth: three orthogonal switches (operator env, UI session, file
 * marker per workspace) prevent accidental enable from any single
 * misconfiguration.
 */

export interface YoloGateContext {
	env: Record<string, string | undefined>;
	uiToggle: boolean;
	workspaceAllowed: boolean;
}

export function isYoloEnabled(ctx: YoloGateContext): boolean {
	const envEnabled = ctx.env.APOHARA_YOLO === "1";
	return envEnabled && ctx.uiToggle === true && ctx.workspaceAllowed === true;
}
