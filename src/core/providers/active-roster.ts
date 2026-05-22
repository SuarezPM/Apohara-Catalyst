/**
 * Active roster per spec §6.5.
 *
 * Exactly 3 CLI-wrapper providers in default mode. Setting
 * APOHARA_LEGACY_PROVIDERS=1 unlocks the 21 cloud + gemini-cli + gemini-oauth
 * (defined in legacy-roster.ts, filled in Stage 6).
 */
import type { BaseAgentProvider } from "./BaseAgentProvider";
import { ClaudeCodeProvider } from "./ClaudeCodeProvider";
import { CodexProvider } from "./CodexProvider";
import { OpenCodeProvider } from "./OpenCodeProvider";
import { getLegacyProviders } from "./legacy-roster";

export const ACTIVE_PROVIDER_FACTORIES = [
  () => new ClaudeCodeProvider(),
  () => new CodexProvider(),
  () => new OpenCodeProvider(),
] as const;

export function getActiveProviders(): BaseAgentProvider[] {
  const active = ACTIVE_PROVIDER_FACTORIES.map(f => f());
  if (process.env.APOHARA_LEGACY_PROVIDERS === "1") {
    return [...active, ...getLegacyProviders()];
  }
  return active;
}