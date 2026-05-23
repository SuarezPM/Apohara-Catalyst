import { BaseAgentProvider, type AgentRole } from "./BaseAgentProvider";
import { CodexProtocol } from "./protocols/CodexProtocol";
import type { ProviderId } from "./agent-config";

export class CodexProvider extends BaseAgentProvider {
  // CodexProtocol holds `children: Map<sessionId, ChildProcess>` so
  // abortSession can SIGTERM the right child. A fresh-per-access getter
  // would orphan that Map on every call — cache the instance.
  private readonly _protocol = new CodexProtocol();
  get id(): ProviderId { return "codex-cli"; }
  get displayName(): string { return "Codex"; }
  get roles(): readonly AgentRole[] { return ["coder"]; }
  get protocol() { return this._protocol; }
}