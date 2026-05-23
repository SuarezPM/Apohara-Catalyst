/**
 * Claude Code protocol per spec §4.5.
 *
 * T4.7a (Sprint 4): spawn real de `claude --print` con sanitizeEnv (§0.4 —
 * no ANTHROPIC_API_KEY leak; regla earned the hard way pre-33d6901).
 *
 * G5.A.1 (nimbalyst #1.1): persistent stdin via `appendToStdin` / `endStdin`.
 * The Claude SDK closes stdin on `type: "result"`, which breaks late
 * `can_use_tool` calls — we keep our own handle and only close on explicit
 * `endStdin` or `abortSession`.
 *
 * G5.A.2 (nimbalyst #1.2): `sendMessage` parses Claude's NDJSON stream
 * (`{"type":"event","subtype":"text",...}`) and emits canonical
 * `ProtocolEvent` events.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { sanitizeEnv } from "../../persistence/envSanitizer.js";
import { stripControlChars } from "../../protocols/line-framed";
import { parseClaudeLine } from "./claude-stream";
import type {
  AgentProtocol,
  CreateSessionOpts,
  SpawnedSession,
  ProtocolEvent,
  Message,
} from "./AgentProtocol";

interface ClaudeSession {
  child: ChildProcess;
  stdinOpen: boolean;
}

export class ClaudeCodeProtocol implements AgentProtocol {
  private readonly sessions = new Map<string, ClaudeSession>();

  async createSession(opts: CreateSessionOpts): Promise<SpawnedSession> {
    // §0.4: sanitize process.env (strips ANTHROPIC_API_KEY, AWS_*, etc.), then
    // overlay caller-provided opts.env (typically APOHARA_* runtime overrides).
    const env = { ...sanitizeEnv(process.env), ...(opts.env ?? {}) };
    const child = spawn(
      "claude",
      ["--print", "--workspace", opts.workspacePath],
      {
        env,
        cwd: opts.workspacePath,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const providerId = `claude-${child.pid}-${Date.now()}`;
    this.sessions.set(providerId, { child, stdinOpen: true });
    if (opts.systemPrompt) {
      child.stdin?.write(opts.systemPrompt + "\n");
      // We INTENTIONALLY do NOT call stdin.end() — persistent stdin (G5.A.1)
      // requires the handle to stay open across turns.
    }
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
        // G7.5.A.9: strip ANSI + C0 control bytes before parsing. Some
        // CLIs detect a TTY parent and emit color even with --no-color.
        const ev = parseClaudeLine(stripControlChars(line));
        if (ev) yield ev;
        nl = buf.indexOf("\n");
      }
    }
    if (buf.length > 0) {
      const ev = parseClaudeLine(stripControlChars(buf));
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
