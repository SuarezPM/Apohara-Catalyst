/**
 * Self-describing guardrail flags (symphony #14, G5.G.8).
 *
 * AMBIGUO in the spec was: "an event fires without an emitter, so the
 * UI cannot label it". This module resolves that by making every flag
 * carry the metadata the UI/audit/telemetry surfaces consume: a stable
 * code, a human description, a severity, and a suggested action.
 *
 * Pattern
 * -------
 * TypeScript enums are too thin (no methods). Instead we expose a
 * frozen class instance per flag, mounted on a `GuardrailFlag` object
 * so call sites read `GuardrailFlag.PROMPT_INJECTION_DETECTED`. Each
 * instance is the SINGLE source of truth — UI, audit, and telemetry
 * all consult the same methods so they cannot drift.
 *
 * Adding a new flag is intentionally three lines: an entry in `defs`,
 * the union string in `GuardrailFlagCode`, and the property assignment
 * at the bottom. Compiler will fail loudly if any one is missed.
 */

export type GuardrailSeverity = "info" | "warning" | "error" | "critical";

export type GuardrailFlagCode =
	| "PROMPT_INJECTION_DETECTED"
	| "RATE_LIMIT_EXCEEDED"
	| "BUDGET_EXCEEDED"
	| "HALLUCINATION_FLAG"
	| "PATH_ESCAPE_ATTEMPT"
	| "TOOL_AUTO_APPROVAL_DENIED"
	| "SANDBOX_ESCAPE_ATTEMPT"
	| "ACCEPTANCE_CRITERIA_NOT_MET";

interface GuardrailFlagDef {
	code: GuardrailFlagCode;
	severity: GuardrailSeverity;
	description: string;
	suggestedAction: string;
}

const defs: ReadonlyArray<GuardrailFlagDef> = [
	{
		code: "PROMPT_INJECTION_DETECTED",
		severity: "critical",
		description:
			"Hostile instructions were detected inside untrusted content (file/URL) the agent was reading.",
		suggestedAction:
			"Abort the current task, review the input source, and re-run with the untrusted content quoted.",
	},
	{
		code: "RATE_LIMIT_EXCEEDED",
		severity: "warning",
		description:
			"The provider responded with HTTP 429 / quota error; further calls in this window will fail.",
		suggestedAction:
			"Back off and retry after the cooldown indicated by the provider's Retry-After header.",
	},
	{
		code: "BUDGET_EXCEEDED",
		severity: "error",
		description:
			"The task's token / cost budget was exhausted before completion.",
		suggestedAction:
			"Raise the budget for this task or split it into smaller sub-tasks with their own budgets.",
	},
	{
		code: "HALLUCINATION_FLAG",
		severity: "warning",
		description:
			"The agent referenced a file, symbol, or fact that could not be verified against the workspace.",
		suggestedAction:
			"Open the verification panel to see which claims need ground-truth checks before acceptance.",
	},
	{
		code: "PATH_ESCAPE_ATTEMPT",
		severity: "critical",
		description:
			"A tool tried to read or write a path that escaped the workspace root via symlink or '..'.",
		suggestedAction:
			"Inspect the audit log for the offending tool call; the worker has been stopped.",
	},
	{
		code: "TOOL_AUTO_APPROVAL_DENIED",
		severity: "info",
		description:
			"A tool call did not match the auto-approval safe-list and was sent for user approval.",
		suggestedAction:
			"No action required; approve or deny in the permissions UI as usual.",
	},
	{
		code: "SANDBOX_ESCAPE_ATTEMPT",
		severity: "critical",
		description:
			"A subprocess attempted a syscall outside the seccomp-bpf allow-list.",
		suggestedAction:
			"Abort the agent run, review the sandbox log, and report the regression upstream.",
	},
	{
		code: "ACCEPTANCE_CRITERIA_NOT_MET",
		severity: "error",
		description:
			"The verification mesh found at least one acceptance criterion still failing.",
		suggestedAction:
			"Re-run the task with the unmet criteria injected as additionalContext, or relax the criterion.",
	},
] as const;

/**
 * Concrete flag class. Instances are frozen at module load so callers
 * cannot mutate the metadata at runtime (this is the contract for the
 * UI/audit/telemetry consumers — they trust the metadata).
 */
class GuardrailFlagInstance {
	constructor(private readonly def: GuardrailFlagDef) {
		Object.freeze(this);
	}

	code(): GuardrailFlagCode {
		return this.def.code;
	}

	severity(): GuardrailSeverity {
		return this.def.severity;
	}

	description(): string {
		return this.def.description;
	}

	suggestedAction(): string {
		return this.def.suggestedAction;
	}
}

// Build the flag map. We assert each def aligns with the union literal
// by indexing it explicitly — if a `code` is missing from
// `GuardrailFlagCode`, this object literal will fail to type-check.
const byCode = new Map<GuardrailFlagCode, GuardrailFlagInstance>();
for (const def of defs) {
	byCode.set(def.code, new GuardrailFlagInstance(def));
}

/**
 * Resolve a stable string code back to its flag instance, or
 * `undefined` if the code is not registered.
 */
export function flagFromString(code: string): GuardrailFlagInstance | undefined {
	return byCode.get(code as GuardrailFlagCode);
}

/** Iterate every known flag instance — order matches `defs`. */
export function allGuardrailFlags(): GuardrailFlagInstance[] {
	return defs.map((d) => byCode.get(d.code)!);
}

/**
 * Named exports per flag, so call sites read
 * `GuardrailFlag.PROMPT_INJECTION_DETECTED.severity()`. The
 * `Record<GuardrailFlagCode, GuardrailFlagInstance>` type guarantees
 * exhaustiveness — a missing key fails the build.
 */
export const GuardrailFlag: Record<GuardrailFlagCode, GuardrailFlagInstance> = {
	PROMPT_INJECTION_DETECTED: byCode.get("PROMPT_INJECTION_DETECTED")!,
	RATE_LIMIT_EXCEEDED: byCode.get("RATE_LIMIT_EXCEEDED")!,
	BUDGET_EXCEEDED: byCode.get("BUDGET_EXCEEDED")!,
	HALLUCINATION_FLAG: byCode.get("HALLUCINATION_FLAG")!,
	PATH_ESCAPE_ATTEMPT: byCode.get("PATH_ESCAPE_ATTEMPT")!,
	TOOL_AUTO_APPROVAL_DENIED: byCode.get("TOOL_AUTO_APPROVAL_DENIED")!,
	SANDBOX_ESCAPE_ATTEMPT: byCode.get("SANDBOX_ESCAPE_ATTEMPT")!,
	ACCEPTANCE_CRITERIA_NOT_MET: byCode.get("ACCEPTANCE_CRITERIA_NOT_MET")!,
} as const;

export type { GuardrailFlagInstance };
