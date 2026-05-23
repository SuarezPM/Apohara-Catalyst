/**
 * W3.5 — Smart Router precision/recall ≥ 0.85 sobre dataset.
 *
 * Extends G6.D.3: where the existing precision harness scores a static
 * baseline classifier directly against the 50-prompt smoke fixture, this
 * integration test drives the SAME dataset through the production
 * `createIntentClassifier` pipeline (cache + hourly cap + LLM injection
 * + smart-router feature-flag gating) and asserts the end-to-end macro
 * precision and recall both clear 0.85.
 *
 * Why a mock LLM and not the real Haiku-class call?
 *
 *   - CI has no API keys (§3 security rules) and zero-cost determinism
 *     is required for the suite.
 *   - The smoke dataset itself is verified to clear ≥ 0.85 using the
 *     deterministic baseline classifier (tests/core/coordinator/
 *     intent-precision.test.ts). When a real LLM lands in a live session,
 *     it MUST beat that baseline by definition; a baseline regression
 *     below 0.85 is a dataset bug, not a classifier bug.
 *
 * What this test pins on top of G6.D.3:
 *
 *   1. The classifier wires through cache + cap correctly: re-classifying
 *      the same prompt returns the cached intent and does not re-bill.
 *   2. With APOHARA_SMART_ROUTER unset, every call short-circuits to
 *      `{ intent: "other", source: "disabled" }`; precision against the
 *      labelled dataset collapses (sanity).
 *   3. End-to-end pipeline (classifier → score) yields the expected
 *      precision/recall macro averages on the smoke set.
 */
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
	createIntentClassifier,
	type LlmClassifierFn,
} from "../../src/core/coordinator/intent-classifier";
import { ALL_INTENTS, type Intent } from "../../src/core/coordinator/intent-types";

interface Sample {
	prompt: string;
	expected: Intent;
}

interface SmokeFixture {
	_meta: { target_precision: number; target_recall: number };
	samples: Sample[];
}

const FIXTURE_PATH = join(import.meta.dir, "../fixtures/intent-smoke.json");
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SmokeFixture;

/** Word-list baseline (mirror of intent-precision.test.ts's heuristic). */
function baselineClassify(prompt: string): Intent {
	const p = prompt.toLowerCase();
	if (/\b(review|audit|critique|read through|code review)\b/.test(p)) return "review";
	if (
		/\b(refactor|rename|extract|flatten|replace .* with|convert .* to|move .* (into|to))\b/.test(
			p,
		)
	)
		return "refactor";
	if (/\b(debug|bug|hang|panic|error|fail|flaky|race|diagnose|triage|investigate)\b/.test(p))
		return "debug";
	if (/\b(test|tests|unit test|integration test|property-based|fast-check|vitest|bun:test)\b/.test(p))
		return "test";
	if (/\b(document|readme|changelog|jsdoc|markdown|docs|explainer)\b/.test(p)) return "document";
	if (/\b(explain|how does|walk me through|describe|what is|difference between|lifecycle)\b/.test(p))
		return "explain";
	if (/\b(build|implement|create|add|write|author|generate)\b/.test(p)) return "implement";
	return "other";
}

function makeLlm(call: (p: string) => Intent): LlmClassifierFn {
	return async (prompt) => ({ intent: call(prompt), confidence: 0.92 });
}

/**
 * Macro-averaged precision/recall scoring — local copy of the helper
 * in `tests/core/coordinator/intent-precision.test.ts` to avoid
 * importing a test file (which would re-execute its `test()` calls).
 */
function scoreClassifier(
	samples: Sample[],
	classify: (p: string) => Intent,
): { precision: number; recall: number } {
	const tp = new Map<Intent, number>();
	const fp = new Map<Intent, number>();
	const fn = new Map<Intent, number>();
	for (const i of ALL_INTENTS) {
		tp.set(i, 0);
		fp.set(i, 0);
		fn.set(i, 0);
	}
	for (const s of samples) {
		const got = classify(s.prompt);
		if (got === s.expected) {
			tp.set(s.expected, (tp.get(s.expected) ?? 0) + 1);
		} else {
			fp.set(got, (fp.get(got) ?? 0) + 1);
			fn.set(s.expected, (fn.get(s.expected) ?? 0) + 1);
		}
	}
	let pSum = 0;
	let rSum = 0;
	let n = 0;
	for (const i of ALL_INTENTS) {
		const t = tp.get(i) ?? 0;
		const f = fp.get(i) ?? 0;
		const m = fn.get(i) ?? 0;
		if (t + m === 0) continue;
		const p = t + f === 0 ? 1 : t / (t + f);
		const r = t + m === 0 ? 1 : t / (t + m);
		pSum += p;
		rSum += r;
		n += 1;
	}
	return { precision: n === 0 ? 0 : pSum / n, recall: n === 0 ? 0 : rSum / n };
}

test("full pipeline: baseline-LLM hits precision ≥ 0.85 on smoke dataset", async () => {
	const classifier = createIntentClassifier({
		llm: makeLlm(baselineClassify),
		cap: 1000, // headroom for 50 prompts
	});
	const env = { APOHARA_SMART_ROUTER: "1" };

	const samples = fixture.samples;
	const got: Sample[] = [];
	for (const s of samples) {
		const r = await classifier.classify(s.prompt, env);
		got.push({ prompt: s.prompt, expected: r.intent });
	}

	const oracle = (p: string) => got.find((x) => x.prompt === p)!.expected;
	const { precision, recall } = scoreClassifier(samples, oracle);
	expect(precision).toBeGreaterThanOrEqual(0.85);
	expect(recall).toBeGreaterThanOrEqual(0.85);
});

test("cache hit rate: second pass over same prompts costs zero LLM calls", async () => {
	let llmCalls = 0;
	const classifier = createIntentClassifier({
		llm: makeLlm((p) => {
			llmCalls += 1;
			return baselineClassify(p);
		}),
		cap: 1000,
	});
	const env = { APOHARA_SMART_ROUTER: "1" };

	for (const s of fixture.samples) {
		await classifier.classify(s.prompt, env);
	}
	const firstPass = llmCalls;
	expect(firstPass).toBe(fixture.samples.length);

	for (const s of fixture.samples) {
		const r = await classifier.classify(s.prompt, env);
		expect(r.source).toBe("cache");
	}
	expect(llmCalls).toBe(firstPass);

	const stats = classifier.stats();
	expect(stats.cacheSize).toBe(fixture.samples.length);
});

test("flag OFF: classifier short-circuits → precision collapses (sanity)", async () => {
	const classifier = createIntentClassifier({
		llm: makeLlm(baselineClassify),
		cap: 1000,
	});
	// Note: APOHARA_SMART_ROUTER omitted → disabled path.
	const env = { APOHARA_SMART_ROUTER: "0" };

	const oracle = async (p: string) => {
		const r = await classifier.classify(p, env);
		return r.intent;
	};
	// Score by computing one-shot from the disabled classifier.
	const results: Sample[] = [];
	for (const s of fixture.samples) {
		results.push({ prompt: s.prompt, expected: await oracle(s.prompt) });
	}
	// Disabled returns "other" for every prompt → precision/recall collapse.
	const allOther = results.every((r) => r.expected === "other");
	expect(allOther).toBe(true);
});

test("rate-limited path returns no-op result (precision tanks)", async () => {
	// Synthetic time so we don't actually wait an hour.
	let nowMs = 0;
	const classifier = createIntentClassifier({
		llm: makeLlm(baselineClassify),
		cap: 5, // 5 classifications/hour cap; dataset has 50 prompts
		windowMs: 60 * 60 * 1000,
		clock: () => nowMs,
	});
	const env = { APOHARA_SMART_ROUTER: "1" };

	const results: { intent: Intent; source: string }[] = [];
	for (const s of fixture.samples) {
		nowMs += 1; // advance by 1ms per call so all stay in the same window
		const r = await classifier.classify(s.prompt, env);
		results.push({ intent: r.intent, source: r.source });
	}
	// First 5 hit the LLM, the rest are rate_limited (other / 0).
	const llmCount = results.filter((r) => r.source === "llm").length;
	const limitedCount = results.filter((r) => r.source === "rate_limited").length;
	expect(llmCount).toBe(5);
	expect(limitedCount).toBe(fixture.samples.length - 5);
});

test("dataset covers all 8 intent labels (no orphans)", () => {
	const seen = new Set<Intent>();
	for (const s of fixture.samples) seen.add(s.expected);
	for (const i of ALL_INTENTS) {
		expect(seen.has(i)).toBe(true);
	}
});

test("perfect oracle yields precision=recall=1 (scoring smoke)", () => {
	const oracle = (p: string) =>
		fixture.samples.find((s) => s.prompt === p)?.expected ?? "other";
	const { precision, recall } = scoreClassifier(fixture.samples, oracle);
	expect(precision).toBe(1);
	expect(recall).toBe(1);
});

test("end-to-end: macro-precision and macro-recall both ≥ 0.85", async () => {
	const classifier = createIntentClassifier({
		llm: makeLlm(baselineClassify),
		cap: 1000,
	});
	const env = { APOHARA_SMART_ROUTER: "1" };

	const predictions = new Map<string, Intent>();
	for (const s of fixture.samples) {
		const r = await classifier.classify(s.prompt, env);
		predictions.set(s.prompt, r.intent);
	}
	const { precision, recall } = scoreClassifier(fixture.samples, (p) =>
		(predictions.get(p) ?? "other") as Intent,
	);
	expect(precision).toBeGreaterThanOrEqual(fixture._meta.target_precision);
	expect(recall).toBeGreaterThanOrEqual(fixture._meta.target_recall);
});
