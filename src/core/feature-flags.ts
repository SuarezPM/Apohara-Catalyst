/**
 * Capabilities-based feature flags per vibe-kanban inspiration (G5.A.10).
 *
 * Each feature declares a set of provider capabilities it requires.
 * `isFeatureEnabled(name, providerId)` is true iff:
 *   1. No explicit opt-out is set for `name`.
 *   2. Every required capability is present in the active provider's
 *      capability set (queried via `hasCapability` from G5.A.7).
 *
 * This is what stops the UI from offering a "multi-turn" follow-up box
 * when the active provider doesn't support multi_turn — gated at one
 * call site, no scattered `if (providerId === "claude-code-cli")` checks.
 *
 * Features register at module-load time (typically near the consuming
 * component or alongside the provider registry). Tests reset via
 * `resetFeatureFlags()`.
 */
import { hasCapability, type Capability } from "./providers/capabilities";
import type { ProviderId } from "./providers/agent-config";

export interface FeatureSpec {
  requires: readonly (Capability | string)[];
}

const features = new Map<string, FeatureSpec>();
const optOuts = new Map<string, boolean>();

export function registerFeature(name: string, spec: FeatureSpec): void {
  features.set(name, spec);
}

export function setFeatureOptOut(name: string, optOut: boolean): void {
  if (optOut) optOuts.set(name, true);
  else optOuts.delete(name);
}

export function isFeatureEnabled(
  name: string,
  providerId: ProviderId | string,
): boolean {
  const spec = features.get(name);
  if (!spec) return false;
  if (optOuts.get(name) === true) return false;
  for (const cap of spec.requires) {
    if (!hasCapability(providerId, cap)) return false;
  }
  return true;
}

export function listFeatures(): string[] {
  return [...features.keys()];
}

export function resetFeatureFlags(): void {
  features.clear();
  optOuts.clear();
}
