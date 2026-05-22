/**
 * Codex protocol per spec §4.5.
 * Stage 3 scaffold; Stage 4+ replaces with the real codex CLI integration.
 */
import type { AgentProtocol, CreateSessionOpts, SpawnedSession, ProtocolEvent, Message } from "./AgentProtocol";

export class CodexProtocol implements AgentProtocol {
  async createSession(_opts: CreateSessionOpts): Promise<SpawnedSession> {
    return { providerId: `codex-${Date.now()}`, spawnedAt: Date.now() };
  }
  async resumeSession(sessionId: string): Promise<SpawnedSession> {
    return { providerId: sessionId, spawnedAt: Date.now() };
  }
  async forkSession(sessionId: string, _atTurn: number): Promise<SpawnedSession> {
    return { providerId: sessionId + "-fork", spawnedAt: Date.now() };
  }
  async *sendMessage(_sessionId: string, _msg: Message): AsyncIterable<ProtocolEvent> {
    yield { kind: "complete", reason: "finished" };
  }
  async abortSession(_sessionId: string): Promise<void> {}
}