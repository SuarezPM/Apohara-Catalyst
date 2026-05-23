/**
 * Codex protocol per spec §4.5.
 *
 * T4.7b — spawn real de `codex exec --json` (reemplaza el scaffold de Stage 3).
 *
 * §0.4: TODO env va por sanitizeEnv — nunca filtramos OPENAI_API_KEY ni otros
 * secrets al subprocess. Pablo's hard rule: CLI wrappers ONLY, no API keys.
 *
 * Sesiones se trackean por providerId = `codex-${pid}-${timestamp}` (PID lo
 * hace único aunque dos createSession() caigan en el mismo ms).
 *
 * G5.A.1 (nimbalyst #1.1): `appendToStdin` / `endStdin` keep the stdin
 * handle open across turns so multi-turn flows do not re-spawn the child.
 *
 * G5.A.2 (nimbalyst #1.2): `sendMessage` consumes the child's stdout
 * (`codex exec --json` emits one JSON object per line) and yields the
 * canonical `ProtocolEvent` stream.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { sanitizeEnv } from "../../persistence/envSanitizer";
import { parseCodexLine } from "./codex-stream";
import type {
  AgentProtocol,
  CreateSessionOpts,
  SpawnedSession,
  ProtocolEvent,
  Message,
} from "./AgentProtocol";

interface CodexSession {
  child: ChildProcess;
  stdinOpen: boolean;
}

export class CodexProtocol implements AgentProtocol {
  /** Children vivos por providerId — para abortSession y para que el GC no los recoja. */
  private readonly sessions = new Map<string, CodexSession>();

  /** Test-only: clear the in-memory map (does NOT kill children). */
  get children(): Map<string, ChildProcess> {
    // Backwards-compatible accessor used by older tests.
    const out = new Map<string, ChildProcess>();
    for (const [k, v] of this.sessions) out.set(k, v.child);
    return out;
  }

  async createSession(opts: CreateSessionOpts): Promise<SpawnedSession> {
    const env = sanitizeEnv(process.env, {
      allow: Object.keys(opts.env ?? {}),
    });
    // Mezclar overrides explícitos del caller después de sanitizar.
    for (const [k, v] of Object.entries(opts.env ?? {})) env[k] = v;

    const child = spawn(
      "codex",
      ["exec", "--json", "--workspace", opts.workspacePath],
      {
        env,
        cwd: opts.workspacePath,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    // Si el binario no existe, el `error` event llega async; capturarlo aquí
    // para que el test pueda decidir skip vs throw.
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        child.removeListener("spawn", onSpawn);
        reject(err);
      };
      const onSpawn = () => {
        child.removeListener("error", onError);
        resolve();
      };
      child.once("error", onError);
      child.once("spawn", onSpawn);
    });

    const providerId = `codex-${child.pid}-${Date.now()}`;
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
    // Send the message via persistent stdin (G5.A.1 + G5.A.6).
    if (sess.stdinOpen) {
      sess.child.stdin?.write(msg.content + "\n");
    }
    // Stream stdout: codex emits NDJSON lines. We yield events until the
    // child closes stdout. Tests pipe through fake processes when the real
    // binary is missing — this loop is a no-op then.
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
        const ev = parseCodexLine(line);
        if (ev) yield ev;
        nl = buf.indexOf("\n");
      }
    }
    if (buf.length > 0) {
      const ev = parseCodexLine(buf);
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
