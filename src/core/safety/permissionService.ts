/**
 * Permission decision engine per spec §4.6.
 *
 * Decision order (deny-first wins):
 *   1. settings.deny  — explicit blocks ALWAYS win, even over a cached allow.
 *   2. cache          — session-scoped user approvals (scope=session).
 *   3. settings.allow — user_global / project_shared / project_local merged tier.
 *   4. otherwise: ask — emit suggested pattern + available scopes.
 *
 * Compound bash special case: if the command contains `&&`, `||`, or `;`,
 * we force scope=["once"] only. Approving `git status && rm -rf /` for the
 * whole session would let later `git status && <anything>` slip through.
 */
import { matchPattern, parsePatternString, type ToolInvocation } from "./patterns";
import { splitCompound } from "./bashCompoundAnalyzer";
import type { MergedSettings } from "./settingsHierarchy";
import { PermissionCache } from "./permissionCache";

export type PermissionScope = "once" | "session" | "always";

export type PermissionDecision =
  | { kind: "allow"; reason: "cached" | "settings_allow" }
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

  // 2. Session cache (scope=session approvals).
  for (const cached of opts.cache.list(sessionId)) {
    const p = parsePatternString(cached);
    if (p && matchPattern(p, inv)) {
      return { kind: "allow", reason: "cached" };
    }
  }

  // 3. Settings allow (merged tier). Skip for compound bash (INV-15).
  if (!isCompound) {
    for (const allowStr of opts.settings.allow) {
      const p = parsePatternString(allowStr);
      if (p && matchPattern(p, inv)) {
        return { kind: "allow", reason: "settings_allow" };
      }
    }
  }

  // 4. Need to ask the user. Scopes already restricted for compound.
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
