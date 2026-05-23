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
 *
 * G5.A.1 (nimbalyst #1.1): persistent stdin via `appendToStdin` / `endStdin`.
 * G5.A.2 (nimbalyst #1.2): `sendMessage` parses opencode NDJSON
 *   ({ type: "text" | "tool_use" | "step_finish" | ... }) and yields the
 *   canonical `ProtocolEvent` stream.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { sanitizeEnv } from "../../persistence/envSanitizer";
import { parseOpenCodeLine } from "./opencode-stream";
import type {
  AgentProtocol,
  CreateSessionOpts,
  SpawnedSession,
  ProtocolEvent,
  Message,
} from "./AgentProtocol";

interface OpenCodeSession {
  child: ChildProcess;
  stdinOpen: boolean;
}

export class OpenCodeProtocol implements AgentProtocol {
  private readonly sessions = new Map<string, OpenCodeSession>();

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
    this.sessions.set(providerId, { child, stdinOpen: true });
    return { providerId, spawnedAt: Date.now() };
  }

  async resumeSession(sessionId: string): Promise<SpawnedSession> {
    return { providerId: sessionId, spawnedAt: Date.now() };
  }

  async forkSession(sessionId: string, _atTurn: number): Promise<SpawnedSession> {
    return { providerId: sessionId + "-fork", spawnedAt: Date.now() };
  }

  async *sendMessage(
    sessionId: string,
    msg: Message,
  ): AsyncIterable<ProtocolEvent> {
    const sess = this.sessions.get(sessionId);
    if (!sess) {
      yield { kind: "complete", reason: "error" };
      return;
    }
    if (sess.stdinOpen) {
      sess.child.stdin?.write(msg.content + "\n");
    }
    const stdout = sess.child.stdout;
    if (!stdout) {
      yield { kind: "complete", reason: "finished" };
      return;
    }
    let buf = "";
    for await (const chunk of stdout as AsyncIterable<Buffer>) {
      buf += chunk.toString("utf8");
      let nl = buf.indexOf("\n");
      while (nl !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        const ev = parseOpenCodeLine(line);
        if (ev) yield ev;
        nl = buf.indexOf("\n");
      }
    }
    if (buf.length > 0) {
      const ev = parseOpenCodeLine(buf);
      if (ev) yield ev;
    }
    yield { kind: "complete", reason: "finished" };
  }

  async appendToStdin(sessionId: string, data: string): Promise<void> {
    const sess = this.sessions.get(sessionId);
    if (!sess) throw new Error(`no session: ${sessionId}`);
    if (!sess.stdinOpen) throw new Error(`stdin already closed: ${sessionId}`);
    await new Promise<void>((resolve, reject) => {
      sess.child.stdin?.write(data, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async endStdin(sessionId: string): Promise<void> {
    const sess = this.sessions.get(sessionId);
    if (!sess) throw new Error(`no session: ${sessionId}`);
    sess.child.stdin?.end();
    sess.stdinOpen = false;
  }

  async abortSession(sessionId: string): Promise<void> {
    const sess = this.sessions.get(sessionId);
    if (!sess) return;
    if (!sess.child.killed) sess.child.kill("SIGTERM");
    this.sessions.delete(sessionId);
  }
}
