import { BaseAgentProvider, type AgentRole } from "./BaseAgentProvider";
import { OpenCodeProtocol } from "./protocols/OpenCodeProtocol";
import type { ProviderId } from "./agent-config";

export class OpenCodeProvider extends BaseAgentProvider {
  // Cache the Protocol so future per-session state (Sprint 5 wires
  // persistent stdin + JSON-NDJSON stream parser) is not orphaned by
  // a fresh-per-access getter.
  private readonly _protocol = new OpenCodeProtocol();
  get id(): ProviderId { return "opencode-go"; }
  get displayName(): string { return "OpenCode"; }
  get roles(): readonly AgentRole[] { return ["explorer", "editor"]; }
  get protocol() { return this._protocol; }
}