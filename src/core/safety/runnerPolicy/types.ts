export type PolicyPreset = "Strict" | "Balanced" | "Advisory" | "ExternalSandbox" | "Custom";

export type EnforcementStrength = "Enforced" | "Partial" | "Advisory" | "Unsupported";

export interface Enforcement {
  area: "filesystem" | "network" | "credentials" | "publish" | "commands" | "external_sandbox";
  strength: EnforcementStrength;
  critical: boolean;
  description?: string;
}

export interface FilesystemPolicy {
  protectedPaths: string[];
  readonlyPaths: string[];
  writableScope: "workspace" | "anywhere";
}

export interface NetworkPolicy {
  allowedDomains: string[];
  blockedDomains: string[];
  defaultAction: "allow" | "deny";
}

export interface CredentialsPolicy {
  scanForLeaks: boolean;
  blockOnSuspectedLeak: boolean;
}

export interface PublishPolicy {
  blockPushToMain: boolean;
  blockForcePush: boolean;
  requireSignedCommits: boolean;
}

export interface CommandsPolicy {
  blocked: string[];
  warnOnly: string[];
}

export interface ExternalSandboxPolicy {
  enabled: boolean;
  tool?: "bwrap" | "firejail";
}

export interface RunnerExecutionPolicy {
  preset: PolicyPreset;
  filesystem: FilesystemPolicy;
  network: NetworkPolicy;
  credentials: CredentialsPolicy;
  publish: PublishPolicy;
  commands: CommandsPolicy;
  external_sandbox: ExternalSandboxPolicy;
}

export interface ExecutionPlan {
  policy: PolicyPreset;
  enforcement: Enforcement[];
  rejected: boolean;
  rejection_reason?: string;
}