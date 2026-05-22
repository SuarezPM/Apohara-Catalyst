import type { RunnerExecutionPolicy } from "./types";

export const STRICT: RunnerExecutionPolicy = {
  preset: "Strict",
  filesystem: {
    protectedPaths: ["AGENTS.md", "CLAUDE.md", ".apohara/**", ".env*"],
    readonlyPaths: ["docs/superpowers/specs/**"],
    writableScope: "workspace",
  },
  network: { allowedDomains: ["github.com", "npmjs.org", "crates.io", "docs.rs"], blockedDomains: [], defaultAction: "deny" },
  credentials: { scanForLeaks: true, blockOnSuspectedLeak: true },
  publish: { blockPushToMain: true, blockForcePush: true, requireSignedCommits: false },
  commands: { blocked: ["^rm\\s+-rf\\s+/", "^sudo\\s+", "curl.*\\|\\s*sudo"], warnOnly: [] },
  external_sandbox: { enabled: false },
};

export const BALANCED: RunnerExecutionPolicy = {
  preset: "Balanced",
  filesystem: { protectedPaths: ["AGENTS.md", "CLAUDE.md", ".env*"], readonlyPaths: [], writableScope: "workspace" },
  network: { allowedDomains: [], blockedDomains: [], defaultAction: "allow" },
  credentials: { scanForLeaks: true, blockOnSuspectedLeak: false },
  publish: { blockPushToMain: true, blockForcePush: false, requireSignedCommits: false },
  commands: { blocked: ["^rm\\s+-rf\\s+/$"], warnOnly: ["^sudo\\s+"] },
  external_sandbox: { enabled: false },
};

export const ADVISORY: RunnerExecutionPolicy = {
  preset: "Advisory",
  filesystem: { protectedPaths: [], readonlyPaths: [], writableScope: "anywhere" },
  network: { allowedDomains: [], blockedDomains: [], defaultAction: "allow" },
  credentials: { scanForLeaks: true, blockOnSuspectedLeak: false },
  publish: { blockPushToMain: false, blockForcePush: false, requireSignedCommits: false },
  commands: { blocked: [], warnOnly: ["^rm\\s+-rf", "^sudo\\s+"] },
  external_sandbox: { enabled: false },
};

export const EXTERNAL_SANDBOX: RunnerExecutionPolicy = {
  ...STRICT,
  preset: "ExternalSandbox",
  external_sandbox: { enabled: true, tool: "bwrap" },
};