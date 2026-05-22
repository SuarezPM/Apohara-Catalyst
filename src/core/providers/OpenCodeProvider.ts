import { BaseAgentProvider, type AgentRole } from "./BaseAgentProvider";
import { OpenCodeProtocol } from "./protocols/OpenCodeProtocol";
import type { ProviderId } from "./agent-config";

export class OpenCodeProvider extends BaseAgentProvider {
  get id(): ProviderId { return "opencode-go"; }
  get displayName(): string { return "OpenCode"; }
  get roles(): readonly AgentRole[] { return ["explorer", "editor"]; }
  get protocol() { return new OpenCodeProtocol(); }
}