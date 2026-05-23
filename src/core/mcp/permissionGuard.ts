/**
 * chorus H11 / T3.12 — deny-by-non-registration for MCP tools.
 *
 * Tools must be explicitly registered with a `requiredPerm`; an agent
 * sees a tool only if BOTH conditions hold:
 *   1. The tool was registered via `registerPermissionedTool`, AND
 *   2. The required permission has been granted via `grantPermission`.
 *
 * The default — unregistered tools — is "invisible". This closes the
 * common MCP gap where a tool accidentally exposed by an upstream
 * server (or sneaked in via dynamic registration) is callable by any
 * agent that finds it in the tool list. Apohara's guard renders the
 * list, so anything not registered does not appear.
 *
 * The class is intentionally storage-agnostic (in-memory maps). Callers
 * that need persistence wrap it; doing so here would couple the guard
 * to a particular store and make tests slower than they need to be.
 *
 * G7.5.A.9: guardrail-flag ingestion. When a tool's `requiredPerm` matches
 * a registered `GuardrailFlagCode`, callers can ask the guard to surface
 * the flag's self-describing metadata (severity, description, suggested
 * action) via `describeRequiredFlag`. UI / audit / telemetry consume the
 * SAME instance so labels cannot drift across surfaces.
 */
import {
  flagFromString,
  type GuardrailFlagInstance,
  type GuardrailSeverity,
} from "../safety/guardrail-flags";

export interface PermissionedToolSpec {
  tool: string;
  requiredPerm: string;
}

/** Flat view of a guardrail flag for UI/audit consumers. */
export interface GuardrailFlagMetadata {
  code: string;
  severity: GuardrailSeverity;
  description: string;
  suggestedAction: string;
}

export class PermissionGuard {
  private registered = new Map<string, string>(); // tool -> requiredPerm
  private granted = new Set<string>();

  registerPermissionedTool(spec: PermissionedToolSpec): void {
    this.registered.set(spec.tool, spec.requiredPerm);
  }

  grantPermission(perm: string): void {
    this.granted.add(perm);
  }

  revokePermission(perm: string): void {
    this.granted.delete(perm);
  }

  isToolVisible(tool: string): boolean {
    const req = this.registered.get(tool);
    if (req === undefined) return false; // deny by non-registration
    return this.granted.has(req);
  }

  visibleTools(): string[] {
    return Array.from(this.registered.keys()).filter(t => this.isToolVisible(t));
  }

  /**
   * If `tool`'s `requiredPerm` matches a registered guardrail flag code,
   * return its self-describing metadata; otherwise `undefined`. Used by
   * the UI and audit sink to render a uniform label without each surface
   * hand-rolling its own copy of the flag taxonomy.
   */
  describeRequiredFlag(tool: string): GuardrailFlagMetadata | undefined {
    const req = this.registered.get(tool);
    if (req === undefined) return undefined;
    const flag: GuardrailFlagInstance | undefined = flagFromString(req);
    if (!flag) return undefined;
    return {
      code: flag.code(),
      severity: flag.severity(),
      description: flag.description(),
      suggestedAction: flag.suggestedAction(),
    };
  }
}
