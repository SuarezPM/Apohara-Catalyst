import type { RunnerExecutionPolicy } from "./types";

/**
 * Regex patterns for catastrophically destructive commands. The previous
 * `^rm\\s+-rf\\s+/$` only blocked the literal `rm -rf /`; this set adds:
 *   - `rm` flag re-orderings (`-fr`, `--recursive --force`, etc.)
 *   - explicit override (`rm -rf / --no-preserve-root`)
 *   - the same destruction via `dd`, `mkfs`, `wipefs`, `shred`
 *   - the classic `:(){:|:&};:` fork-bomb
 *   - shutdown / reboot / poweroff
 *
 * Each entry is anchored with `^` so the match only fires when the user
 * actually invokes the destructive program (not when it appears inside
 * an argument like `echo "rm -rf /"`).
 */
const DESTRUCTIVE_CORE: string[] = [
  // rm: any flag order that combines recursive + force + root target
  "^rm\\s+(--recursive\\s+--force|--force\\s+--recursive|-[a-zA-Z]*[rR][a-zA-Z]*[fF][a-zA-Z]*|-[a-zA-Z]*[fF][a-zA-Z]*[rR][a-zA-Z]*)\\s+(--no-preserve-root\\s+)?/+(\\s|$)",
  // dd to a raw block device (data-loss in seconds)
  "^dd\\s+.*of=/dev/(sd|nvme|hd|vd|xvd|loop|mmcblk)",
  // mkfs* on a block device
  "^mkfs(\\.\\w+)?\\s+.*/dev/",
  "^wipefs\\s+",
  // shred a block device or root
  "^shred\\s+.*/dev/",
  // Power state — only block when invoked WITHOUT a clear non-immediate flag
  "^(shutdown|poweroff|halt|reboot)\\b",
  // Classic fork-bomb
  ":\\(\\)\\s*\\{\\s*:\\|:&\\s*\\}\\s*;\\s*:",
];

/** Patterns that escalate via curl/wget into a shell. */
const PIPE_TO_SHELL: string[] = [
  "(curl|wget|fetch)\\s+[^|]*\\|\\s*(sudo\\s+)?(sh|bash|zsh|fish|dash|ksh)\\b",
];

/** sudo invocations — blocked in strict policies, warned in advisory. */
const SUDO_BARE = "^sudo\\s+";

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
  commands: {
    blocked: [...DESTRUCTIVE_CORE, ...PIPE_TO_SHELL, SUDO_BARE],
    warnOnly: [],
  },
  external_sandbox: { enabled: false },
};

export const BALANCED: RunnerExecutionPolicy = {
  preset: "Balanced",
  filesystem: { protectedPaths: ["AGENTS.md", "CLAUDE.md", ".env*"], readonlyPaths: [], writableScope: "workspace" },
  network: { allowedDomains: [], blockedDomains: [], defaultAction: "allow" },
  credentials: { scanForLeaks: true, blockOnSuspectedLeak: false },
  publish: { blockPushToMain: true, blockForcePush: false, requireSignedCommits: false },
  commands: {
    blocked: [...DESTRUCTIVE_CORE, ...PIPE_TO_SHELL],
    warnOnly: [SUDO_BARE],
  },
  external_sandbox: { enabled: false },
};

export const ADVISORY: RunnerExecutionPolicy = {
  preset: "Advisory",
  filesystem: { protectedPaths: [], readonlyPaths: [], writableScope: "anywhere" },
  network: { allowedDomains: [], blockedDomains: [], defaultAction: "allow" },
  credentials: { scanForLeaks: true, blockOnSuspectedLeak: false },
  publish: { blockPushToMain: false, blockForcePush: false, requireSignedCommits: false },
  commands: {
    blocked: [],
    warnOnly: [...DESTRUCTIVE_CORE, ...PIPE_TO_SHELL, SUDO_BARE],
  },
  external_sandbox: { enabled: false },
};

export const EXTERNAL_SANDBOX: RunnerExecutionPolicy = {
  ...STRICT,
  preset: "ExternalSandbox",
  external_sandbox: { enabled: true, tool: "bwrap" },
};
