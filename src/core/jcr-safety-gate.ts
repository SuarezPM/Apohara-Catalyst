/**
 * JCR Safety Gate — TS port of `apohara_context_forge/safety/jcr_gate.py`.
 *
 * Implements INV-15 (Judge Dense-Prefill Invariant) from
 * Suarez, P.M. "Inv-15: A Formal Safety Invariant for KV-Cache Reuse in
 * Multi-Agent Judge Pipelines", May 2026, DOI 10.5281/zenodo.20114594.
 *
 * The invariant: any judge-class agent whose JCR risk score exceeds τ
 * must use dense prefill — no shared KV reuse — to prevent silent
 * verdict corruption from positional priors cached during a prior
 * candidate ranking (the "Judge Candidate Reuse" failure mode of
 * arXiv:2601.08343).
 *
 * In the Apohara orchestrator the analogue of "dense prefill" is:
 * the arbiter call in the verification mesh MUST NOT consume a
 * compressed/optimized context from ContextForge — it must receive
 * the full fresh context. The gate decides whether to bypass any
 * upstream context-compression step on a per-invocation basis.
 *
 * Constants match the production Python (which differs slightly from
 * the paper's stylized Algorithm 1 — see comments below).
 */

// Roles considered "judge-type" — protected by INV-15.
export const JUDGE_ROLES = new Set<string>(["critic", "judge"]);

// Default risk threshold above which dense prefill is mandated (paper §3.4).
export const DEFAULT_JCR_THRESHOLD = 0.7;

// Risk-model constants. The production Python implementation
// (apohara_context_forge/safety/jcr_gate.py) uses these refined values
// instead of the paper's stylized fixed-increment form:
//   - paper: αn = 0.2 if ncand ≥ 3   (binary)
//   - prod:  αn = 0.10 * max(0, ncand - 2)   (continuous)
//   - paper: αu = 0.1 if u > 0.8
//   - prod:  αu = 0.15 if u > 0.8
// We follow the prod numbers so cross-process (Apohara TS vs ContextForge
// Python) gate decisions agree on identical inputs.
const _BASE_RISK_JUDGE = 0.6;
const _BASE_RISK_OTHER = 0.1;
const _RISK_PER_EXTRA_CANDIDATE = 0.1; // +0.1 per candidate beyond 2
const _RISK_LAYOUT_SHUFFLED = 0.2; // +0.2 if order changed since last round
const _RISK_HIGH_REUSE = 0.15; // +0.15 if reuse_rate > 0.8
const _HIGH_REUSE_THRESHOLD = 0.8;

export interface JCRDecision {
	agentRole: string;
	riskScore: number;
	useDense: boolean;
	reason: string;
	/** Epoch milliseconds when the decision was made. */
	timestamp: number;
}

export interface JCRSummary {
	totalDecisions: number;
	denseFallbackCount: number;
	avgRiskScore: number;
	criticDenseRate: number;
}

/**
 * Inputs to the gate per agent invocation. Mirrors the paper's tuple
 * x = (ρ, n_cand, u, s).
 */
export interface JCRGateInput {
	/** Agent role string. Case-insensitive; lowercased internally. */
	agentRole: string;
	/** Number of candidates the agent will compare. Must be ≥ 0. */
	candidateCount: number;
	/** Fraction of KV blocks the registry would serve from cache, in [0, 1]. */
	reuseRate: number;
	/** Whether the candidate layout has changed since the last invocation. */
	layoutShuffled: boolean;
}

/**
 * Safety gate that detects when KV-reuse is risky for judge-type agents.
 * Critic / judge invocations above the risk threshold are forced through
 * dense prefill (no shared context); non-judge invocations always pass.
 *
 * Per Theorem 1 of the paper: any pipeline that calls `gateDecision` once
 * per agent invocation and respects its boolean output satisfies INV-15
 * by construction — zero violations.
 */
export class JCRSafetyGate {
	readonly threshold: number;
	private readonly log: JCRDecision[] = [];

	constructor(threshold: number = DEFAULT_JCR_THRESHOLD) {
		if (!(threshold >= 0 && threshold <= 1)) {
			throw new Error(`jcr threshold must be in [0, 1]; got ${threshold}`);
		}
		this.threshold = threshold;
	}

	/**
	 * Compute the JCR risk score for an upcoming agent step.
	 * Returns a value in [0.0, 1.0]; higher means KV reuse is more
	 * likely to corrupt the judge's verdict.
	 */
	computeJcrRisk(input: JCRGateInput): number {
		const { agentRole, candidateCount, reuseRate, layoutShuffled } = input;
		if (candidateCount < 0) {
			throw new Error("candidateCount must be non-negative");
		}
		if (!(reuseRate >= 0 && reuseRate <= 1)) {
			throw new Error("reuseRate must be in [0, 1]");
		}

		const role = (agentRole || "").toLowerCase();
		let risk = JUDGE_ROLES.has(role) ? _BASE_RISK_JUDGE : _BASE_RISK_OTHER;
		if (candidateCount > 2) {
			risk += _RISK_PER_EXTRA_CANDIDATE * (candidateCount - 2);
		}
		if (layoutShuffled) {
			risk += _RISK_LAYOUT_SHUFFLED;
		}
		if (reuseRate > _HIGH_REUSE_THRESHOLD) {
			risk += _RISK_HIGH_REUSE;
		}
		return Math.max(0, Math.min(1, risk));
	}

	/**
	 * INV-15 boolean form: returns true iff judge-role risk exceeds the
	 * threshold. Non-judge roles always return false — the invariant
	 * only constrains judge-class agents.
	 */
	shouldUseDensePrefill(input: JCRGateInput): boolean {
		const risk = this.computeJcrRisk(input);
		const role = (input.agentRole || "").toLowerCase();
		return JUDGE_ROLES.has(role) && risk > this.threshold;
	}

	/**
	 * Make a gate decision and append it to the audit log. Use this
	 * instead of `shouldUseDensePrefill` when telemetry / compliance
	 * audit is required (which it is for the verification mesh —
	 * INV-15 audits scan the log for `(ρ ∈ J ∧ r > τ ∧ use_dense = false)`
	 * and expect count = 0).
	 */
	gateDecision(input: JCRGateInput): JCRDecision {
		const risk = this.computeJcrRisk(input);
		const role = (input.agentRole || "").toLowerCase();
		const isJudge = JUDGE_ROLES.has(role);
		const useDense = isJudge && risk > this.threshold;

		let reason: string;
		if (!isJudge) {
			reason = `role='${role}' not judge-type → reuse OK`;
		} else if (useDense) {
			reason =
				`INV-15: judge role='${role}' risk=${risk.toFixed(2)} > ` +
				`threshold=${this.threshold.toFixed(2)} → dense prefill mandated`;
		} else {
			reason =
				`judge role='${role}' risk=${risk.toFixed(2)} ≤ ` +
				`threshold=${this.threshold.toFixed(2)} → reuse permitted`;
		}

		const decision: JCRDecision = {
			agentRole: role,
			riskScore: risk,
			useDense,
			reason,
			timestamp: Date.now(),
		};
		this.log.push(decision);
		return decision;
	}

	/** Aggregate stats over all decisions logged so far. */
	summary(): JCRSummary {
		const total = this.log.length;
		if (total === 0) {
			return {
				totalDecisions: 0,
				denseFallbackCount: 0,
				avgRiskScore: 0,
				criticDenseRate: 0,
			};
		}
		const denseCount = this.log.filter((d) => d.useDense).length;
		const avgRisk = this.log.reduce((acc, d) => acc + d.riskScore, 0) / total;
		const criticDecisions = this.log.filter((d) => d.agentRole === "critic");
		const criticDense = criticDecisions.filter((d) => d.useDense).length;
		const criticRate =
			criticDecisions.length > 0 ? criticDense / criticDecisions.length : 0;
		return {
			totalDecisions: total,
			denseFallbackCount: denseCount,
			avgRiskScore: avgRisk,
			criticDenseRate: criticRate,
		};
	}

	/** Read-only view of the audit log. */
	getLog(): readonly JCRDecision[] {
		return this.log;
	}
}
