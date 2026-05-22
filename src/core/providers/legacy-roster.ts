/**
 * Legacy roster placeholder per spec §6.5.
 *
 * Stage 6 expands this to the full 21 cloud providers + gemini-cli +
 * gemini-oauth wiring. For Stage 3 we just need a non-empty list so the
 * roster test can verify the env-var-gated expansion behavior.
 */
import { BaseAgentProvider, type AgentRole } from "./BaseAgentProvider";
import type { ProviderId } from "./agent-config";
import type { AgentProtocol, CreateSessionOpts, SpawnedSession, ProtocolEvent, Message } from "./protocols/AgentProtocol";

class LegacyPlaceholderProtocol implements AgentProtocol {
  async createSession(_opts: CreateSessionOpts): Promise<SpawnedSession> {
    throw new Error("legacy placeholder cannot spawn — Stage 6 fills this");
  }
  async resumeSession(_id: string): Promise<SpawnedSession> {
    throw new Error("legacy placeholder cannot spawn — Stage 6 fills this");
  }
  async forkSession(_id: string, _turn: number): Promise<SpawnedSession> {
    throw new Error("legacy placeholder cannot spawn — Stage 6 fills this");
  }
  async *sendMessage(_id: string, _msg: Message): AsyncIterable<ProtocolEvent> {
    throw new Error("legacy placeholder cannot spawn — Stage 6 fills this");
  }
  async abortSession(_id: string): Promise<void> {}
}

class LegacyPlaceholderProvider extends BaseAgentProvider {
  get id() { return "legacy-placeholder" as unknown as ProviderId; }
  get displayName() { return "Legacy placeholder"; }
  get roles(): readonly AgentRole[] { return ["coder"]; }
  get protocol() { return new LegacyPlaceholderProtocol(); }
}

export function getLegacyProviders(): BaseAgentProvider[] {
  return [new LegacyPlaceholderProvider()];
}