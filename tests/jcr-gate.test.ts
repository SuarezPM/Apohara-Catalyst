/**
 * INV-15 JCR Safety Gate — port-fidelity + paper Table 1 sweep.
 *
 * Mirrors the empirical verification in Suarez, "Inv-15: A Formal
 * Safety Invariant for KV-Cache Reuse in Multi-Agent Judge Pipelines"
 * (DOI 10.5281/zenodo.20114594), Section 5 Table 1: a 9-point sweep
 * over the four risk axes producing zero violations and a
 * critic_dense_rate of 1.000.
 *
 * Risk values reported in this test file use the PRODUCTION constants
 * from apohara_context_forge/safety/jcr_gate.py (αn=0.1·(n-2) continuous,
 * αu=0.15) rather than the paper's stylized Algorithm 1 (αn=0.2 binary,
 * αu=0.10). The boolean Dense? column matches the paper exactly because
 * τ=0.7 is the same and the safety property only depends on whether
 * judge-role risk crosses τ — every paper-high-risk critic row produces
 * risk ≥ 0.9 under both parameterizations.
 */

import { describe, expect, it } from "bun:test";
import {
	DEFAULT_JCR_THRESHOLD,
	JCRSafetyGate,
	JUDGE_ROLES,
} from "../src/core/jcr-safety-gate";

describe("JCRSafetyGate — constants and constructor", () => {
	it("exposes the paper's default threshold τ = 0.7", () => {
		expect(DEFAULT_JCR_THRESHOLD).toBe(0.7);
		const g = new JCRSafetyGate();
		expect(g.threshold).toBe(0.7);
	});

	it("recognizes judge-class roles per paper §3.1", () => {
		expect(JUDGE_ROLES.has("critic")).toBe(true);
		expect(JUDGE_ROLES.has("judge")).toBe(true);
		expect(JUDGE_ROLES.has("retriever")).toBe(false);
		expect(JUDGE_ROLES.has("responder")).toBe(false);
	});

	it("rejects out-of-range thresholds", () => {
		expect(() => new JCRSafetyGate(-0.1)).toThrow();
		expect(() => new JCRSafetyGate(1.5)).toThrow();
	});

	it("rejects malformed risk inputs", () => {
		const g = new JCRSafetyGate();
		expect(() =>
			g.computeJcrRisk({
				agentRole: "critic",
				candidateCount: -1,
				reuseRate: 0.5,
				layoutShuffled: false,
			}),
		).toThrow();
		expect(() =>
			g.computeJcrRisk({
				agentRole: "critic",
				candidateCount: 3,
				reuseRate: 1.5,
				layoutShuffled: false,
			}),
		).toThrow();
	});
});

describe("JCRSafetyGate — paper Table 1 (9-point sweep)", () => {
	// (role, ncand, s, u, expectedDense). Risk values are intentionally not
	// asserted to a fixed scalar — the gate decision is the safety contract.
	type Row = {
		role: string;
		ncand: number;
		s: 0 | 1;
		u: number;
		expectedDense: boolean;
	};
	const rows: Row[] = [
		// High-risk (Critic) — all fire INV-15
		{ role: "critic", ncand: 5, s: 1, u: 0.9, expectedDense: true },
		{ role: "critic", ncand: 4, s: 1, u: 0.85, expectedDense: true },
		{ role: "critic", ncand: 3, s: 1, u: 0.95, expectedDense: true },
		{ role: "critic", ncand: 5, s: 1, u: 0.5, expectedDense: true },
		{ role: "critic", ncand: 6, s: 0, u: 0.85, expectedDense: true },
		// Low-risk (non-judge) — never fire INV-15
		{ role: "retriever", ncand: 2, s: 1, u: 0.9, expectedDense: false },
		{ role: "reranker", ncand: 5, s: 1, u: 0.95, expectedDense: false },
		{ role: "summarizer", ncand: 3, s: 0, u: 0.9, expectedDense: false },
		{ role: "responder", ncand: 5, s: 1, u: 0.8, expectedDense: false },
	];

	it("matches paper Table 1: Dense? column on all 9 rows", () => {
		const g = new JCRSafetyGate();
		for (const row of rows) {
			const dec = g.gateDecision({
				agentRole: row.role,
				candidateCount: row.ncand,
				reuseRate: row.u,
				layoutShuffled: row.s === 1,
			});
			expect(dec.useDense).toBe(row.expectedDense);
		}
	});

	it("Theorem 1: zero INV-15 violations across the full sweep", () => {
		const g = new JCRSafetyGate();
		for (const row of rows) {
			g.gateDecision({
				agentRole: row.role,
				candidateCount: row.ncand,
				reuseRate: row.u,
				layoutShuffled: row.s === 1,
			});
		}
		// A violation is: judge role ∧ risk > τ ∧ useDense = false.
		const log = g.getLog();
		const violations = log.filter(
			(d) =>
				JUDGE_ROLES.has(d.agentRole) &&
				d.riskScore > g.threshold &&
				!d.useDense,
		);
		expect(violations.length).toBe(0);
	});

	it("Section 5.4 metric: critic dense prefill rate = 1.000", () => {
		const g = new JCRSafetyGate();
		for (const row of rows) {
			g.gateDecision({
				agentRole: row.role,
				candidateCount: row.ncand,
				reuseRate: row.u,
				layoutShuffled: row.s === 1,
			});
		}
		const s = g.summary();
		expect(s.totalDecisions).toBe(9);
		expect(s.denseFallbackCount).toBe(5); // all 5 critic invocations
		expect(s.criticDenseRate).toBe(1.0);
	});
});

describe("JCRSafetyGate — risk model edge cases", () => {
	it("base risk: bJ = 0.6 for judge, bO = 0.1 for other (ncand=2, s=0, u=0)", () => {
		const g = new JCRSafetyGate();
		const judgeRisk = g.computeJcrRisk({
			agentRole: "critic",
			candidateCount: 2,
			reuseRate: 0,
			layoutShuffled: false,
		});
		const otherRisk = g.computeJcrRisk({
			agentRole: "retriever",
			candidateCount: 2,
			reuseRate: 0,
			layoutShuffled: false,
		});
		expect(judgeRisk).toBeCloseTo(0.6, 5);
		expect(otherRisk).toBeCloseTo(0.1, 5);
	});

	it("multi-candidate penalty: αn = 0.1 per extra candidate beyond 2", () => {
		const g = new JCRSafetyGate();
		const r2 = g.computeJcrRisk({
			agentRole: "responder",
			candidateCount: 2,
			reuseRate: 0,
			layoutShuffled: false,
		});
		const r3 = g.computeJcrRisk({
			agentRole: "responder",
			candidateCount: 3,
			reuseRate: 0,
			layoutShuffled: false,
		});
		const r4 = g.computeJcrRisk({
			agentRole: "responder",
			candidateCount: 4,
			reuseRate: 0,
			layoutShuffled: false,
		});
		expect(r3 - r2).toBeCloseTo(0.1, 5);
		expect(r4 - r3).toBeCloseTo(0.1, 5);
	});

	it("layout-shuffled penalty: αs = 0.2", () => {
		const g = new JCRSafetyGate();
		const stable = g.computeJcrRisk({
			agentRole: "responder",
			candidateCount: 2,
			reuseRate: 0,
			layoutShuffled: false,
		});
		const shuffled = g.computeJcrRisk({
			agentRole: "responder",
			candidateCount: 2,
			reuseRate: 0,
			layoutShuffled: true,
		});
		expect(shuffled - stable).toBeCloseTo(0.2, 5);
	});

	it("high-reuse penalty: αu = 0.15 iff u > 0.8 (threshold is strict)", () => {
		const g = new JCRSafetyGate();
		const justBelow = g.computeJcrRisk({
			agentRole: "responder",
			candidateCount: 2,
			reuseRate: 0.8,
			layoutShuffled: false,
		});
		const justAbove = g.computeJcrRisk({
			agentRole: "responder",
			candidateCount: 2,
			reuseRate: 0.81,
			layoutShuffled: false,
		});
		expect(justBelow).toBeCloseTo(0.1, 5);
		expect(justAbove - justBelow).toBeCloseTo(0.15, 5);
	});

	it("caps risk at 1.0 even with all penalties stacked", () => {
		const g = new JCRSafetyGate();
		const r = g.computeJcrRisk({
			agentRole: "critic",
			candidateCount: 20,
			reuseRate: 0.99,
			layoutShuffled: true,
		});
		expect(r).toBe(1);
	});

	it("non-judge never fires the gate, regardless of risk magnitude", () => {
		const g = new JCRSafetyGate();
		const dec = g.gateDecision({
			agentRole: "reranker",
			candidateCount: 10,
			reuseRate: 0.99,
			layoutShuffled: true,
		});
		expect(dec.riskScore).toBeGreaterThan(g.threshold);
		expect(dec.useDense).toBe(false);
	});

	it("threshold is strict (>), not (≥) — a risk exactly at τ does not fire", () => {
		const g = new JCRSafetyGate(0.6); // Custom τ matching critic base
		const dec = g.gateDecision({
			agentRole: "critic",
			candidateCount: 2,
			reuseRate: 0,
			layoutShuffled: false,
		});
		expect(dec.riskScore).toBeCloseTo(0.6, 5);
		expect(dec.useDense).toBe(false); // 0.6 > 0.6 is false
	});

	it("case-insensitive role matching", () => {
		const g = new JCRSafetyGate();
		const dec = g.gateDecision({
			agentRole: "CRITIC",
			candidateCount: 5,
			reuseRate: 0.9,
			layoutShuffled: true,
		});
		expect(dec.agentRole).toBe("critic");
		expect(dec.useDense).toBe(true);
	});
});

describe("JCRSafetyGate — telemetry", () => {
	it("empty summary when no decisions logged", () => {
		const g = new JCRSafetyGate();
		const s = g.summary();
		expect(s.totalDecisions).toBe(0);
		expect(s.denseFallbackCount).toBe(0);
		expect(s.avgRiskScore).toBe(0);
		expect(s.criticDenseRate).toBe(0);
	});

	it("summary accumulates across decisions and exposes audit trail", () => {
		const g = new JCRSafetyGate();
		g.gateDecision({
			agentRole: "critic",
			candidateCount: 5,
			reuseRate: 0.9,
			layoutShuffled: true,
		});
		g.gateDecision({
			agentRole: "responder",
			candidateCount: 2,
			reuseRate: 0,
			layoutShuffled: false,
		});
		const s = g.summary();
		expect(s.totalDecisions).toBe(2);
		expect(s.denseFallbackCount).toBe(1);
		expect(s.criticDenseRate).toBe(1.0);
		expect(g.getLog().length).toBe(2);
		expect(g.getLog()[0].reason).toContain("INV-15");
	});
});
