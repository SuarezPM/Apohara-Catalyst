import { BaseAgentProvider, type AgentRole } from "./BaseAgentProvider";
import { CodexProtocol } from "./protocols/CodexProtocol";
import type { ProviderId } from "./agent-config";

export class CodexProvider extends BaseAgentProvider {
  get id(): ProviderId { return "codex-cli"; }
  get displayName(): string { return "Codex"; }
  get roles(): readonly AgentRole[] { return ["coder"]; }
  get protocol() { return new CodexProtocol(); }
}