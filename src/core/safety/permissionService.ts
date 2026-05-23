/**
 * Permission decision engine per spec §4.6.
 *
 * Decision order (deny-first wins):
 *   1. settings.deny    — explicit blocks ALWAYS win, even over a cached allow.
 *   2. auto-approval    — heuristic safe-list (G5.G.6 / G7.5.A.9): read-only
 *                         tools and pure-read Bash commands short-circuit to
 *                         `allow` WITHOUT prompting the user. Deny remains
 *                         above this so the user's explicit veto wins.
 *   3. cache            — session-scoped user approvals (scope=session).
 *   4. settings.allow   — user_global / project_shared / project_local merged tier.
 *   5. otherwise: ask   — emit suggested pattern + available scopes.
 *
 * Compound bash special case: if the command contains `&&`, `||`, or `;`,
 * we force scope=["once"] only. Approving `git status && rm -rf /` for the
 * whole session would let later `git status && <anything>` slip through.
 *
 * G7.5.A.9: auto-approval consultation. The classifier in
 * `auto-approval.ts` already enforces the composition rule (a compound's
 * unsafe leg poisons the whole), so we can safely consult it even for
 * Bash invocations — but we still keep the INV-15 scope clamp below the
 * auto-approval check so an "allow" decision NEVER touches scopes.
 */
import { matchPattern, parsePatternString, type ToolInvocation } from "./patterns";
import { splitCompound } from "./bashCompoundAnalyzer";
import type { MergedSettings } from "./settingsHierarchy";
import { PermissionCache } from "./permissionCache";
import { classifyToolForAutoApproval, type ToolCall } from "./auto-approval";

export type PermissionScope = "once" | "session" | "always";

export type PermissionDecision =
  | { kind: "allow"; reason: "cached" | "settings_allow" | "auto_approved" }
  | { kind: "deny"; reason: "settings_deny" | "compound_unsafe" }
  | { kind: "ask"; suggested_pattern: string; available_scopes: PermissionScope[] };

export interface PermissionServiceOpts {
  cache: PermissionCache;
  settings: MergedSettings;
}

export function check(
  sessionId: string,
  inv: ToolInvocation,
  opts: PermissionServiceOpts,
): PermissionDecision {
  // 0. Compound bash guard (INV-15): always redirect to ask with ["once"].
  //    Must be checked BEFORE allow-list to prevent "always" scope leak.
  let scopes: PermissionScope[] = ["once", "session", "always"];
  let isCompound = false;
  if (inv.tool === "Bash" && typeof inv.input.command === "string") {
    if (splitCompound(inv.input.command).length > 1) {
      scopes = ["once"];
      isCompound = true;
    }
  }

  // 1. Deny first — absolute veto.
  for (const denyStr of opts.settings.deny) {
    const p = parsePatternString(denyStr);
    if (p && matchPattern(p, inv)) {
      return { kind: "deny", reason: "settings_deny" };
    }
  }

  // 2. Auto-approval heuristic (G7.5.A.9). Runs AFTER deny so any explicit
  //    veto from the user still wins. The classifier is default-deny; only
  //    a positive "allow" from it short-circuits, otherwise we fall through
  //    to the regular allow/cache/ask path.
  const autoCall: ToolCall = { tool: inv.tool, input: inv.input };
  const auto = classifyToolForAutoApproval(autoCall);
  if (auto.decision === "allow") {
    return { kind: "allow", reason: "auto_approved" };
  }

  // 3. Session cache (scope=session approvals).
  for (const cached of opts.cache.list(sessionId)) {
    const p = parsePatternString(cached);
    if (p && matchPattern(p, inv)) {
      return { kind: "allow", reason: "cached" };
    }
  }

  // 4. Settings allow (merged tier). Skip for compound bash (INV-15).
  if (!isCompound) {
    for (const allowStr of opts.settings.allow) {
      const p = parsePatternString(allowStr);
      if (p && matchPattern(p, inv)) {
        return { kind: "allow", reason: "settings_allow" };
      }
    }
  }

  // 5. Need to ask the user. Scopes already restricted for compound.
  return {
    kind: "ask",
    suggested_pattern: suggestPattern(inv),
    available_scopes: scopes,
  };
}

function suggestPattern(inv: ToolInvocation): string {
  if (inv.tool === "Bash" && typeof inv.input.command === "string") {
    const first = inv.input.command.trim().split(/\s+/)[0] ?? "";
    return `Bash(${first}:*)`;
  }
  if (inv.tool === "Edit" && typeof inv.input.file_path === "string") {
    return `Edit(${inv.input.file_path})`;
  }
  if (inv.tool === "WebFetch" && typeof inv.input.url === "string") {
    try {
      const u = new URL(inv.input.url);
      return `WebFetch(domain:${u.hostname})`;
    } catch {
      return `WebFetch(*)`;
    }
  }
  return inv.tool;
}
