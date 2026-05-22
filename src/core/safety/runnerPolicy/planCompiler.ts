import type { RunnerExecutionPolicy, ExecutionPlan, Enforcement } from "./types";

export function compileRunnerExecutionPlan(policy: RunnerExecutionPolicy): ExecutionPlan {
  const enforcement: Enforcement[] = [];

  enforcement.push({
    area: "filesystem",
    strength: policy.filesystem.protectedPaths.length > 0 ? "Enforced" : "Unsupported",
    critical: policy.filesystem.protectedPaths.length > 0,
    description: `${policy.filesystem.protectedPaths.length} protected paths, scope: ${policy.filesystem.writableScope}`,
  });

  enforcement.push({
    area: "network",
    strength: policy.network.defaultAction === "deny" ? "Enforced" : "Advisory",
    critical: policy.network.defaultAction === "deny",
    description: `default: ${policy.network.defaultAction}, allowed: ${policy.network.allowedDomains.length}`,
  });

  enforcement.push({
    area: "credentials",
    strength: policy.credentials.blockOnSuspectedLeak ? "Enforced" : "Advisory",
    critical: policy.credentials.scanForLeaks,
    description: policy.credentials.blockOnSuspectedLeak ? "block on leak" : "scan only",
  });

  enforcement.push({
    area: "publish",
    strength: policy.publish.blockPushToMain ? "Enforced" : "Advisory",
    critical: policy.publish.blockPushToMain,
    description: `block-push-to-main: ${policy.publish.blockPushToMain}`,
  });

  enforcement.push({
    area: "commands",
    strength: policy.commands.blocked.length > 0 ? "Enforced" : "Advisory",
    critical: policy.commands.blocked.some(r => /rm\s+-rf|sudo/.test(r)),
    description: `${policy.commands.blocked.length} blocked, ${policy.commands.warnOnly.length} warn-only`,
  });

  enforcement.push({
    area: "external_sandbox",
    strength: policy.external_sandbox.enabled ? "Enforced" : "Unsupported",
    critical: false,
    description: policy.external_sandbox.tool ?? "disabled",
  });

  if (policy.preset === "Strict") {
    const violations = enforcement.filter(e =>
      e.critical && (e.strength === "Partial" || e.strength === "Unsupported"),
    );
    if (violations.length > 0) {
      return {
        policy: policy.preset,
        enforcement,
        rejected: true,
        rejection_reason: `Strict mode rejects critical enforcement with strength ${violations[0].strength} for area ${violations[0].area}`,
      };
    }
  }

  return { policy: policy.preset, enforcement, rejected: false };
}