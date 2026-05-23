import { test, expect } from "bun:test";
import {
	createIntentClassifier,
	CLASSIFIER_SYSTEM_PROMPT,
	buildUserPayload,
	hashPrompt,
} from "../../../src/core/coordinator/intent-classifier";

function makeFakeLlm(intent: "implement" | "refactor" | "explain" | "other", confidence = 0.9) {
	let calls = 0;
	const fn = async (_prompt: string) => {
		calls += 1;
		return { intent, confidence };
	};
	return { fn, getCalls: () => calls };
}

test("classify returns disabled when feature flag off", async () => {
	const fake = makeFakeLlm("implement");
	const c = createIntentClassifier({ llm: fake.fn });
	const r = await c.classify("write a function", {});
	expect(r.intent).toBe("other");
	expect(r.source).toBe("disabled");
	expect(fake.getCalls()).toBe(0);
});

test("classify hits LLM on first call, cache on second", async () => {
	const fake = makeFakeLlm("implement", 0.95);
	const c = createIntentClassifier({ llm: fake.fn });
	const env = { APOHARA_SMART_ROUTER: "1" };
	const r1 = await c.classify("write a fibonacci function", env);
	expect(r1.intent).toBe("implement");
	expect(r1.source).toBe("llm");
	const r2 = await c.classify("write a fibonacci function", env);
	expect(r2.intent).toBe("implement");
	expect(r2.source).toBe("cache");
	expect(fake.getCalls()).toBe(1);
});

test("cap kicks in at 100 (default) and degrades to rate_limited", async () => {
	const fake = makeFakeLlm("refactor");
	const c = createIntentClassifier({ llm: fake.fn, cap: 3 });
	const env = { APOHARA_SMART_ROUTER: "1" };
	// 3 distinct prompts → 3 LLM calls; 4th hits the cap.
	for (let i = 0; i < 3; i++) {
		const r = await c.classify(`task ${i}`, env);
		expect(r.source).toBe("llm");
	}
	const overflow = await c.classify("task 99", env);
	expect(overflow.source).toBe("rate_limited");
	expect(overflow.intent).toBe("other");
});

test("window expires so cap resets", async () => {
	const fake = makeFakeLlm("debug");
	let now = 1_000_000;
	const c = createIntentClassifier({
		llm: fake.fn,
		cap: 2,
		windowMs: 1000,
		clock: () => now,
	});
	const env = { APOHARA_SMART_ROUTER: "1" };
	await c.classify("a", env);
	await c.classify("b", env);
	const blocked = await c.classify("c", env);
	expect(blocked.source).toBe("rate_limited");
	// jump past window
	now += 2_000;
	const allowed = await c.classify("d", env);
	expect(allowed.source).toBe("llm");
});

test("nonsense LLM output gets coerced to other w/ 0 confidence", async () => {
	const c = createIntentClassifier({
		// Intentionally cast through unknown — the test purpose is to feed
		// a bogus label and assert the classifier coerces, not to assert
		// the typed contract.
		llm: async () => ({ intent: "garbage" as unknown as "other", confidence: 0.99 }),
	});
	const env = { APOHARA_SMART_ROUTER: "1" };
	const r = await c.classify("x", env);
	expect(r.intent).toBe("other");
	expect(r.confidence).toBe(0);
});

test("LLM throw degrades to error source", async () => {
	const c = createIntentClassifier({
		llm: async () => {
			throw new Error("boom");
		},
	});
	const env = { APOHARA_SMART_ROUTER: "1" };
	const r = await c.classify("x", env);
	expect(r.source).toBe("error");
	expect(r.intent).toBe("other");
});

test("hashPrompt is deterministic and prompt-content-sensitive", () => {
	expect(hashPrompt("hi")).toBe(hashPrompt("hi"));
	expect(hashPrompt("hi")).not.toBe(hashPrompt("hello"));
});

test("classifier prompt mentions all 8 labels", () => {
	for (const label of [
		"implement",
		"refactor",
		"debug",
		"document",
		"test",
		"explain",
		"review",
		"other",
	]) {
		expect(CLASSIFIER_SYSTEM_PROMPT).toContain(label);
	}
});

test("buildUserPayload embeds the prompt", () => {
	const p = buildUserPayload("hello world");
	expect(p).toContain("hello world");
});

test("confidence clamped to [0,1]", async () => {
	const c = createIntentClassifier({ llm: async () => ({ intent: "implement", confidence: 5 }) });
	const env = { APOHARA_SMART_ROUTER: "1" };
	const r = await c.classify("clip me", env);
	expect(r.confidence).toBe(1);
	const c2 = createIntentClassifier({ llm: async () => ({ intent: "implement", confidence: -3 }) });
	c2.resetForTests();
	const r2 = await c2.classify("clip me 2", env);
	expect(r2.confidence).toBe(0);
});
