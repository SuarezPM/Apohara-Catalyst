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
 */
import { spawn, type ChildProcess } from "node:child_process";
import { sanitizeEnv } from "../../persistence/envSanitizer";
import type {
  AgentProtocol,
  CreateSessionOpts,
  SpawnedSession,
  ProtocolEvent,
  Message,
} from "./AgentProtocol";

export class CodexProtocol implements AgentProtocol {
  /** Children vivos por providerId — para abortSession y para que el GC no los recoja. */
  private readonly children = new Map<string, ChildProcess>();

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
    this.children.set(providerId, child);
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

  async abortSession(sessionId: string): Promise<void> {
    const child = this.children.get(sessionId);
    if (!child) return;
    if (!child.killed) child.kill("SIGTERM");
    this.children.delete(sessionId);
  }
}
