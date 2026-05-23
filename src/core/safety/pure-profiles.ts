/**
 * Pure profiles for safety / eval runs (G5.A.11, vibe-kanban inspiration).
 *
 * A "pure" profile constrains a session to a defined subset of
 * side-effecting operations. Three canonical profiles ship:
 *
 *   - `strict`     — no writes, no shell, no git, no network. Read-only.
 *   - `read_only`  — network egress allowed; no local writes or commits.
 *   - `eval`       — local writes allowed (typically under a tmp dir);
 *                    no commits, no network. Used for evaluation runs
 *                    that need to scratch on disk but mustn't leak.
 *
 * Profiles are SafetyDecision factories — the permission service
 * consumes the decision when deciding whether to authorize a tool call.
 * UI uses `isAllowed(profile, action)` for quick gating.
 */

export const PURE_PROFILES = ["strict", "read_only", "eval"] as const;
export type PureProfileName = (typeof PURE_PROFILES)[number];

export type PureAction =
  | "file_read"
  | "file_write"
  | "shell_exec"
  | "git_commit"
  | "network_egress";

export interface PureProfile {
  name: PureProfileName;
  description: string;
  allowed: Record<PureAction, boolean>;
}

export interface SafetyDecision {
  allowed: boolean;
  reason: string;
}

const PROFILES: Record<PureProfileName, PureProfile> = {
  strict: {
    name: "strict",
    description: "Read-only — no writes, no shell, no git, no network.",
    allowed: {
      file_read: true,
      file_write: false,
      shell_exec: false,
      git_commit: false,
      network_egress: false,
    },
  },
  read_only: {
    name: "read_only",
    description: "Read + network allowed; no writes / no commits.",
    allowed: {
      file_read: true,
      file_write: false,
      shell_exec: false,
      git_commit: false,
      network_egress: true,
    },
  },
  eval: {
    name: "eval",
    description: "Eval runs — writes (typically tmp); no commits, no network.",
    allowed: {
      file_read: true,
      file_write: true,
      shell_exec: true,
      git_commit: false,
      network_egress: false,
    },
  },
};

export function getPureProfile(name: PureProfileName): PureProfile {
  const p = PROFILES[name];
  if (!p) throw new Error(`unknown pure profile: ${name}`);
  return p;
}

export function isAllowed(
  profileName: PureProfileName,
  action: PureAction,
): boolean {
  return getPureProfile(profileName).allowed[action] ?? false;
}

export function applyPureProfile(
  profileName: PureProfileName,
  action: PureAction,
): SafetyDecision {
  const allowed = isAllowed(profileName, action);
  return {
    allowed,
    reason: allowed
      ? `pure-profile:${profileName} permits ${action}`
      : `pure-profile:${profileName} denies ${action}`,
  };
}
