/**
 * Provider capabilities tooling per spec §4.5 (nimbalyst inspiration).
 *
 * Each provider declares a flat capability set. Callers query
 * `hasCapability(providerId, cap)` so UI gating (G5.A.10 feature flags)
 * does not hardcode provider ids — when a new provider drops in, declaring
 * the right capabilities here is what unlocks the matching UI surfaces.
 *
 * Capability names are intentionally coarse: they describe USER-VISIBLE
 * feature buckets, not low-level CLI flags. Fine-grained flags belong in
 * `src/core/feature-flags.ts` (G5.A.10).
 */
import type { ProviderId } from "./agent-config";

export const CAPABILITIES = [
  /** Provider supports multiple turns over the same session. */
  "multi_turn",
  /** Provider emits incremental ProtocolEvent stream (not request/response). */
  "streaming",
  /** Provider exposes structured reasoning steps. */
  "reasoning",
  /** Provider emits permission_request events for safety prompting. */
  "permission_request",
  /** Provider participates in file_snapshot diffing (any spawned CLI does). */
  "file_snapshot",
  /** Provider can spawn subagents — false for all active drivers. */
  "subagent_spawn",
  /** Provider responds to /compact / compact_boundary events. */
  "compact",
  /** Provider emits per-step usage tokens for cost attribution. */
  "step_usage",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const TABLE: Record<string, readonly Capability[]> = {
  "claude-code-cli": [
    "multi_turn",
    "streaming",
    "reasoning",
    "permission_request",
    "file_snapshot",
    "compact",
    "step_usage",
  ],
  "codex-cli": [
    "multi_turn",
    "streaming",
    "reasoning",
    "permission_request",
    "file_snapshot",
    "step_usage",
  ],
  "opencode-go": [
    "multi_turn",
    "streaming",
    "reasoning",
    "file_snapshot",
    "step_usage",
  ],
};

export function getCapabilities(providerId: ProviderId | string): readonly Capability[] {
  return TABLE[providerId] ?? [];
}

export function hasCapability(
  providerId: ProviderId | string,
  cap: Capability | string,
): boolean {
  return getCapabilities(providerId).includes(cap as Capability);
}

export function providersWithCapability(
  cap: Capability | string,
): ProviderId[] {
  const out: ProviderId[] = [];
  for (const id of Object.keys(TABLE)) {
    if (hasCapability(id, cap)) out.push(id as ProviderId);
  }
  return out;
}
