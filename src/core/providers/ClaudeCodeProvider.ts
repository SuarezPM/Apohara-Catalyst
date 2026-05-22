import { BaseAgentProvider, type AgentRole } from "./BaseAgentProvider";
import { ClaudeCodeProtocol } from "./protocols/ClaudeCodeProtocol";
import type { ProviderId } from "./agent-config";

export class ClaudeCodeProvider extends BaseAgentProvider {
  get id(): ProviderId { return "claude-code-cli"; }
  get displayName(): string { return "Claude Code"; }
  get roles(): readonly AgentRole[] { return ["planner", "critic"]; }
  get protocol() { return new ClaudeCodeProtocol(); }
}