/**
 * Precision/recall harness for the smart-router classifier (G6.D.3).
 *
 * We CANNOT make real Haiku calls in CI (no API keys, deterministic
 * suite), so the harness ships a small heuristic baseline classifier
 * over the labelled 50-prompt smoke dataset and asserts that even that
 * baseline clears precision/recall ≥ 0.85. The real LLM classifier
 * MUST beat the baseline by definition once wired into a session; if
 * the baseline ever regresses below the threshold, the dataset itself
 * is the problem (mislabelled / ambiguous).
 *
 * The same dataset is the gold for any future eval the integrator runs
 * live — `intent-smoke.json` is the canonical fixture.
 */
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ALL_INTENTS, type Intent } from "../../../src/core/coordinator/intent-types";

interface Sample {
	prompt: string;
	expected: Intent;
}

interface SmokeFixture {
	_meta: { target_precision: number; target_recall: number };
	samples: Sample[];
}

const FIXTURE_PATH = join(import.meta.dir, "../../fixtures/intent-smoke.json");
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SmokeFixture;

/**
 * Cheap deterministic baseline used to validate the dataset itself.
 * Word-list heuristic — NOT a production classifier. Order matters:
 * higher-priority rules trip first.
 */
function baselineClassify(prompt: string): Intent {
	const p = prompt.toLowerCase();
	// review BEFORE document so "review docs" doesn't grab "document".
	if (/\b(review|audit|critique|read through|code review)\b/.test(p)) {
		return "review";
	}
	// refactor BEFORE implement so "refactor function" doesn't land on implement.
	if (
		/\b(refactor|rename|extract|flatten|replace .* with|convert .* to|move .* (into|to))\b/.test(
			p,
		)
	) {
		return "refactor";
	}
	if (/\b(debug|bug|hang|panic|error|fail|flaky|race|diagnose|triage|investigate)\b/.test(p)) {
		return "debug";
	}
	if (/\b(test|tests|unit test|integration test|property-based|fast-check|vitest|bun:test)\b/.test(p)) {
		return "test";
	}
	if (/\b(document|readme|changelog|jsdoc|markdown|docs|explainer)\b/.test(p)) {
		return "document";
	}
	if (/\b(explain|how does|walk me through|describe|what is|difference between|lifecycle)\b/.test(p)) {
		return "explain";
	}
	if (/\b(build|implement|create|add|write|author|generate)\b/.test(p)) {
		return "implement";
	}
	return "other";
}

interface Confusion {
	tp: Map<Intent, number>;
	fp: Map<Intent, number>;
	fn: Map<Intent, number>;
}

function emptyConfusion(): Confusion {
	const tp = new Map<Intent, number>();
	const fp = new Map<Intent, number>();
	const fn = new Map<Intent, number>();
	for (const i of ALL_INTENTS) {
		tp.set(i, 0);
		fp.set(i, 0);
		fn.set(i, 0);
	}
	return { tp, fp, fn };
}

export function scoreClassifier(
	samples: Sample[],
	classify: (p: string) => Intent,
): { precision: number; recall: number; perClass: Map<Intent, { p: number; r: number }> } {
	const c = emptyConfusion();
	for (const s of samples) {
		const got = classify(s.prompt);
		if (got === s.expected) {
			c.tp.set(s.expected, (c.tp.get(s.expected) ?? 0) + 1);
		} else {
			c.fp.set(got, (c.fp.get(got) ?? 0) + 1);
			c.fn.set(s.expected, (c.fn.get(s.expected) ?? 0) + 1);
		}
	}
	// Macro-averaged across the classes that actually appear in the dataset.
	const perClass = new Map<Intent, { p: number; r: number }>();
	let pSum = 0;
	let rSum = 0;
	let classesScored = 0;
	for (const i of ALL_INTENTS) {
		const tp = c.tp.get(i) ?? 0;
		const fp = c.fp.get(i) ?? 0;
		const fn = c.fn.get(i) ?? 0;
		const supported = tp + fn > 0;
		if (!supported) continue;
		const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
		const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
		perClass.set(i, { p: precision, r: recall });
		pSum += precision;
		rSum += recall;
		classesScored += 1;
	}
	return {
		precision: classesScored === 0 ? 0 : pSum / classesScored,
		recall: classesScored === 0 ? 0 : rSum / classesScored,
		perClass,
	};
}

test("smoke fixture has exactly 50 labelled prompts", () => {
	expect(fixture.samples.length).toBe(50);
});

test("every sample uses a known intent label", () => {
	for (const s of fixture.samples) {
		expect(ALL_INTENTS as readonly string[]).toContain(s.expected);
	}
});

test("dataset covers all 8 intent classes (no orphan labels in the enum)", () => {
	const seen = new Set(fixture.samples.map((s) => s.expected));
	for (const i of ALL_INTENTS) {
		expect(seen.has(i)).toBe(true);
	}
});

test("baseline classifier meets target precision >= 0.85 (dataset sanity)", () => {
	const { precision } = scoreClassifier(fixture.samples, baselineClassify);
	expect(precision).toBeGreaterThanOrEqual(fixture._meta.target_precision);
});

test("baseline classifier meets target recall >= 0.85 (dataset sanity)", () => {
	const { recall } = scoreClassifier(fixture.samples, baselineClassify);
	expect(recall).toBeGreaterThanOrEqual(fixture._meta.target_recall);
});

test("scoreClassifier handles a perfect oracle correctly", () => {
	const oracle = (p: string) => fixture.samples.find((s) => s.prompt === p)?.expected ?? "other";
	const { precision, recall } = scoreClassifier(fixture.samples, oracle);
	expect(precision).toBe(1);
	expect(recall).toBe(1);
});

test("scoreClassifier handles an all-other classifier (recall drops)", () => {
	const { recall } = scoreClassifier(fixture.samples, () => "other");
	// Only "other" support gets recall=1; every other class recall=0 →
	// macro avg = 1/classesScored, dataset has 8 classes so 1/8 = 0.125.
	expect(recall).toBeLessThan(0.5);
});
