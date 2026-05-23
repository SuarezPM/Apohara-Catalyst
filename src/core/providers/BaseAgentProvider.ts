/**
 * BaseAgentProvider per spec §4.5 (nimbalyst #1.1 inspiration).
 *
 * Abstract base: subclasses declare id, displayName, roles, and protocol.
 * Base implements spawn (env sanitization + hook env injection + trust
 * preset application + delegation to protocol).
 *
 * --- T4.7d — Delegation contract ---
 *
 * BaseAgentProvider MUST NOT spawn child processes directly. Every spawn
 * routes through `this.protocol.createSession()`. This is the closing wire
 * for nimbalyst #1.2: pre-T4.7a/b/c the 3 Protocol scaffolds were stubs and
 * the only real spawn lived in `src/providers/cli-driver.ts`. T4.7a/b/c
 * moved spawn into Claude/Codex/OpenCode Protocol classes; T4.7d pins the
 * delegation invariant (covered by `tests/integration/protocol-delegated-spawn.test.ts`).
 *
 * Note: `src/providers/cli-driver.ts` is a DIFFERENT code path used by
 * `router.ts` for one-shot LLM calls (text-in/text-out `LLMResponse`).
 * It keeps its own `node:child_process.spawn` because its signature
 * (`LLMMessage[] → LLMResponse`) is incompatible with the session
 * lifecycle protocol (`CreateSessionOpts → SpawnedSession`). Both
 * paths share `sanitizeEnv` (§0.4) and the per-binary FIFO queue
 * (`runSerialized` — load-bearing, see CLAUDE.md past incidents).
 *
 * The Protocol implementations (ClaudeCodeProtocol / CodexProtocol /
 * OpenCodeProtocol) format their providerId as `<provider>-<pid>-<ts>`,
 * which is how `protocol-delegated-spawn.test.ts` proves the spawn
 * actually went through the Protocol — that prefix is the Protocol's
 * fingerprint and can only show up if BaseAgentProvider delegated.
 */
import { sanitizeEnv } from "../persistence/envSanitizer";
import { getApoharaDeps } from "./deps";
import { ProviderSessionManager } from "./mixins/ProviderSessionManager";
import { applyTrustForProvider } from "./trust-presets";
import type { AgentProtocol, CreateSessionOpts, SpawnedSession } from "./protocols/AgentProtocol";
import type { ProviderId } from "./agent-config";

export type AgentRole = "planner" | "coder" | "critic" | "judge" | "explorer" | "editor";

export interface SpawnOpts {
  workspacePath: string;
  taskId?: string;
  worktreeId?: string;
  paneKey?: string;
  env?: Record<string, string | undefined>;
  systemPrompt?: string;
  apoharaSessionId?: string;
}

export abstract class BaseAgentProvider {
  abstract get id(): ProviderId;
  abstract get displayName(): string;
  abstract get roles(): readonly AgentRole[];
  abstract get protocol(): AgentProtocol;

  protected sessionManager = new ProviderSessionManager();

  async spawn(opts: SpawnOpts): Promise<SpawnedSession> {
    // 1. Sanitize env (merge process.env with opts.env, then strip secrets).
    // sanitizeEnv accepts `Record<string, string | undefined>` and filters
    // undefined values internally, but we still pre-filter to keep types tight.
    const merged: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (typeof v === "string") merged[k] = v;
    }
    for (const [k, v] of Object.entries(opts.env ?? {})) {
      if (typeof v === "string") merged[k] = v;
    }
    const baseEnv = sanitizeEnv(merged);

    // 2. Inject Apohara-specific env (post-sanitize so APOHARA_* survives the
    // generic *_TOKEN blocklist rule — APOHARA_HOOK_TOKEN matches `_TOKEN$`).
    const deps = getApoharaDeps();
    const ep = deps.hookEndpoint();
    const apoharaEnv: Record<string, string> = {
      ...baseEnv,
      APOHARA_HOOK_PORT: String(ep.port),
      APOHARA_HOOK_TOKEN: ep.token,
    };
    if (opts.taskId) apoharaEnv.APOHARA_TASK_ID = opts.taskId;
    if (opts.worktreeId) apoharaEnv.APOHARA_WORKTREE_ID = opts.worktreeId;
    if (opts.paneKey) apoharaEnv.APOHARA_PANE_KEY = opts.paneKey;

    // 3. Apply trust preset BEFORE spawn (orca #2 — avoids interactive trust
    // dialog that breaks bracketed-paste and stdio flow). No-op for providers
    // whose AgentConfig declares `preflightTrust: null` (e.g., opencode-go).
    await applyTrustForProvider(this.id, opts.workspacePath);

    // 4. Delegate session creation to the per-provider protocol.
    const createOpts: CreateSessionOpts = {
      workspacePath: opts.workspacePath,
      taskId: opts.taskId,
      worktreeId: opts.worktreeId,
      paneKey: opts.paneKey,
      env: apoharaEnv,
      systemPrompt: opts.systemPrompt,
    };
    const session = await this.protocol.createSession(createOpts);

    // 5. Register the apohara↔provider session id mapping if requested.
    if (opts.apoharaSessionId) {
      this.sessionManager.set(opts.apoharaSessionId, {
        providerId: session.providerId,
        taskId: opts.taskId,
        paneKey: opts.paneKey,
      });
    }

    return session;
  }

  async abort(apoharaSessionId: string): Promise<void> {
    const info = this.sessionManager.get(apoharaSessionId);
    if (!info) return;
    await this.protocol.abortSession(info.providerId);
    this.sessionManager.delete(apoharaSessionId);
  }
}
