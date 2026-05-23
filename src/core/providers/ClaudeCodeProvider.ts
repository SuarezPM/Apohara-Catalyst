import { BaseAgentProvider, type AgentRole } from "./BaseAgentProvider";
import { ClaudeCodeProtocol } from "./protocols/ClaudeCodeProtocol";
import type { ProviderId } from "./agent-config";

export class ClaudeCodeProvider extends BaseAgentProvider {
  // Cache the Protocol instance so per-session state (e.g. CodexProtocol's
  // `children` Map used by abortSession) survives across spawn/abort
  // calls. Returning `new ClaudeCodeProtocol()` per access made those
  // state lookups silently miss.
  private readonly _protocol = new ClaudeCodeProtocol();
  get id(): ProviderId { return "claude-code-cli"; }
  get displayName(): string { return "Claude Code"; }
  get roles(): readonly AgentRole[] { return ["planner", "critic"]; }
  get protocol() { return this._protocol; }
}