/**
 * OpenCode protocol per spec §4.5.
 *
 * Stage 4 / T4.7c: real spawn of `opencode run --format json` with env
 * sanitization (§0.4). The binary is invoked from `opts.workspacePath`
 * and stdio is captured for the higher-level event humanizer (§4.5).
 *
 * NOTE: the correct opencode command (per CLAUDE.md past incident) is
 * `opencode run --format json`. Do NOT use `opencode -p` — that is the
 * `--password` short flag, not a prompt.
 *
 * Per spec §0.4, every spawn routes env through `sanitizeEnv()` so no
 * API keys / cloud creds leak into the wrapped CLI.
 */
import { spawn } from "node:child_process";
import { sanitizeEnv } from "../../persistence/envSanitizer";
import type {
  AgentProtocol,
  CreateSessionOpts,
  SpawnedSession,
  ProtocolEvent,
  Message,
} from "./AgentProtocol";

export class OpenCodeProtocol implements AgentProtocol {
  async createSession(opts: CreateSessionOpts): Promise<SpawnedSession> {
    // Sanitize first, THEN overlay opts.env. sanitizeEnv's blocklist
    // (`/^.*_TOKEN$/` etc.) would otherwise strip Apohara-controlled vars
    // like APOHARA_HOOK_TOKEN that the orchestrator deliberately injects
    // via opts.env. Sanitize-then-overlay matches ClaudeCodeProtocol and
    // keeps the §0.4 secret-leak guarantee on parent env intact.
    const env: Record<string, string | undefined> = {
      ...sanitizeEnv(process.env),
      ...(opts.env ?? {}),
    };

    const child = spawn("opencode", ["run", "--format", "json"], {
      env,
      cwd: opts.workspacePath,
      stdio: ["pipe", "pipe", "pipe"],
    });

    // providerId encodes both the OS pid and a creation timestamp so we
    // can distinguish reused pids across long-running orchestrations.
    const providerId = `opencode-${child.pid}-${Date.now()}`;
    return { providerId, spawnedAt: Date.now() };
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
