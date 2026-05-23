/**
 * Claude Code protocol per spec §4.5.
 *
 * T4.7a (Sprint 4): spawn real de `claude --print` con sanitizeEnv (§0.4 —
 * no ANTHROPIC_API_KEY leak; regla earned the hard way pre-33d6901).
 * Stage 5 G5.A wires streaming (sendMessage real).
 */
import { spawn } from "node:child_process";
import { sanitizeEnv } from "../../persistence/envSanitizer.js";
import type {
  AgentProtocol,
  CreateSessionOpts,
  SpawnedSession,
  ProtocolEvent,
  Message,
} from "./AgentProtocol";

export class ClaudeCodeProtocol implements AgentProtocol {
  async createSession(opts: CreateSessionOpts): Promise<SpawnedSession> {
    // §0.4: sanitize process.env (strips ANTHROPIC_API_KEY, AWS_*, etc.), then
    // overlay caller-provided opts.env (typically APOHARA_* runtime overrides).
    const env = { ...sanitizeEnv(process.env), ...(opts.env ?? {}) };
    const child = spawn("claude", ["--print", "--workspace", opts.workspacePath], {
      env,
      cwd: opts.workspacePath,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const providerId = `claude-${child.pid}-${Date.now()}`;
    if (opts.systemPrompt) {
      child.stdin?.write(opts.systemPrompt + "\n");
      child.stdin?.end();
    }
    return { providerId, spawnedAt: Date.now() };
  }

  async resumeSession(sessionId: string): Promise<SpawnedSession> {
    return { providerId: sessionId, spawnedAt: Date.now() };
  }

  async forkSession(sessionId: string, _atTurn: number): Promise<SpawnedSession> {
    return { providerId: sessionId + "-fork", spawnedAt: Date.now() };
  }

  async *sendMessage(_sessionId: string, _msg: Message): AsyncIterable<ProtocolEvent> {
    // Stage 5 G5.A wires streaming.
    yield { kind: "complete", reason: "finished" };
  }

  async abortSession(_sessionId: string): Promise<void> {}
}
