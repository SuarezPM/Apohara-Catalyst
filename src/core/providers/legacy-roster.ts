/**
 * Legacy roster per spec §6.5.
 *
 * 22 legacy providers (21 cloud + gemini-cli driver). Each is a thin
 * subclass of BaseAgentProvider that THROWS on spawn — they exist for
 * UI compatibility (so the picker can list them when
 * APOHARA_LEGACY_PROVIDERS=1) but require Stage 7+ implementations to
 * actually run.
 *
 * Active roster (apohara-claude-cli, codex-cli, opencode-go) is in
 * active-roster.ts. This file is the escape hatch.
 *
 * Rationale: Apohara v1.0 hardens to 3 CLI drivers for TOS safety —
 * cloud providers require API keys which violate the "no API keys" hard
 * rule. APOHARA_LEGACY_PROVIDERS=1 unlocks for development / migration
 * scenarios where the user accepts the responsibility.
 */
import { BaseAgentProvider, type AgentRole } from "./BaseAgentProvider";
import type { ProviderId } from "./agent-config";
import type { AgentProtocol, CreateSessionOpts, SpawnedSession, ProtocolEvent, Message } from "./protocols/AgentProtocol";

const LEGACY_PROVIDER_NAMES = [
  // Cloud APIs (21)
  "anthropic-api", "openai-api", "groq", "together", "mistral",
  "openrouter", "cohere", "gemini-api", "gemini-oauth", "fireworks",
  "perplexity", "deepseek", "xai", "voyage", "replicate",
  "huggingface", "vertex-ai", "bedrock", "azure-openai", "databricks",
  "snowflake-cortex",
  // CLI driver (1)
  "gemini-cli",
] as const;

type LegacyProviderName = typeof LEGACY_PROVIDER_NAMES[number];

class LegacyStubProtocol implements AgentProtocol {
  constructor(private readonly name: string) {}
  private fail(): never {
    throw new Error(`legacy provider "${this.name}" cannot spawn — set APOHARA_LEGACY_PROVIDERS=1 + provide Stage 7+ implementation`);
  }
  async createSession(_opts: CreateSessionOpts): Promise<SpawnedSession> { return this.fail(); }
  async resumeSession(_id: string): Promise<SpawnedSession> { return this.fail(); }
  async forkSession(_id: string, _turn: number): Promise<SpawnedSession> { return this.fail(); }
  async *sendMessage(_id: string, _msg: Message): AsyncIterable<ProtocolEvent> { yield this.fail(); }
  async abortSession(_id: string): Promise<void> { return; }
}

class LegacyProvider extends BaseAgentProvider {
  constructor(private readonly _name: LegacyProviderName) { super(); }
  // ProviderId is "claude-code-cli" | "codex-cli" | "opencode-go" — legacy
  // names aren't in the union. Cast for now; Stage 7+ can expand the union.
  get id(): ProviderId { return this._name as unknown as ProviderId; }
  get displayName(): string { return `Legacy: ${this._name}`; }
  get roles(): readonly AgentRole[] { return ["coder"]; }
  get protocol() { return new LegacyStubProtocol(this._name); }
}

export function getLegacyProviders(): BaseAgentProvider[] {
  return LEGACY_PROVIDER_NAMES.map(name => new LegacyProvider(name));
}

export { LEGACY_PROVIDER_NAMES };