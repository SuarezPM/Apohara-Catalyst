/**
 * LLM-as-classifier for the smart router (G6.D.2).
 *
 * Hits a Haiku-class model with a one-shot prompt → returns one of the 8
 * intents. Two production-defining knobs:
 *
 *   1. Prompt-hash cache (sha256 of the user prompt → result). Two
 *      identical prompts within the same process should not double-bill.
 *   2. Hourly cap (default 100/h). When exceeded, classifier returns
 *      `{ intent: "other", confidence: 0, fallback: "rate_limited" }`
 *      so the smart router falls back to the user's manual selection
 *      instead of throwing.
 *
 * Gated by `APOHARA_SMART_ROUTER=1`. Calling `classify()` with the flag
 * off returns the no-op result immediately — no LLM call.
 *
 * Classifier is dependency-injected (`LlmClassifierFn`) so tests can run
 * without network / API keys.
 */
import { createHash } from "node:crypto";
import {
	ALL_INTENTS,
	isSmartRouterEnabled,
	type Intent,
} from "./intent-types";

export interface ClassificationResult {
	intent: Intent;
	confidence: number; // 0..1 — LLM-reported or heuristic
	source: "cache" | "llm" | "disabled" | "rate_limited" | "error";
}

export type LlmClassifierFn = (
	prompt: string,
) => Promise<{ intent: Intent; confidence: number }>;

export interface ClassifierOpts {
	llm: LlmClassifierFn;
	cap?: number; // max classifications per window (default 100)
	windowMs?: number; // default 1h
	clock?: () => number; // injectable for tests
}

export interface IntentClassifier {
	classify: (
		prompt: string,
		env?: Record<string, string | undefined>,
	) => Promise<ClassificationResult>;
	stats: () => { cacheSize: number; callsInWindow: number };
	resetForTests: () => void;
}

const DEFAULT_CAP = 100;
const DEFAULT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export function createIntentClassifier(opts: ClassifierOpts): IntentClassifier {
	const cap = opts.cap ?? DEFAULT_CAP;
	const windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;
	const clock = opts.clock ?? Date.now;

	const cache = new Map<string, { intent: Intent; confidence: number }>();
	let callTimestamps: number[] = [];

	async function classify(
		prompt: string,
		env: Record<string, string | undefined> = process.env,
	): Promise<ClassificationResult> {
		if (!isSmartRouterEnabled(env)) {
			return { intent: "other", confidence: 0, source: "disabled" };
		}
		const key = hashPrompt(prompt);
		const cached = cache.get(key);
		if (cached) {
			return { intent: cached.intent, confidence: cached.confidence, source: "cache" };
		}

		// Enforce hourly cap — purge timestamps outside the window first.
		const now = clock();
		callTimestamps = callTimestamps.filter((t) => now - t < windowMs);
		if (callTimestamps.length >= cap) {
			return { intent: "other", confidence: 0, source: "rate_limited" };
		}

		try {
			const result = await opts.llm(prompt);
			if (!ALL_INTENTS.includes(result.intent)) {
				// LLM returned a nonsense label — treat as other w/ low confidence.
				const fallback = { intent: "other" as Intent, confidence: 0 };
				cache.set(key, fallback);
				callTimestamps.push(now);
				return { ...fallback, source: "llm" };
			}
			const clamped = {
				intent: result.intent,
				confidence: clamp01(result.confidence),
			};
			cache.set(key, clamped);
			callTimestamps.push(now);
			return { ...clamped, source: "llm" };
		} catch {
			// LLM hiccup — degrade gracefully so the user's prompt still runs.
			return { intent: "other", confidence: 0, source: "error" };
		}
	}

	return {
		classify,
		stats: () => ({
			cacheSize: cache.size,
			callsInWindow: callTimestamps.length,
		}),
		resetForTests: () => {
			cache.clear();
			callTimestamps = [];
		},
	};
}

export function hashPrompt(prompt: string): string {
	return createHash("sha256").update(prompt, "utf8").digest("hex");
}

function clamp01(n: number): number {
	if (Number.isNaN(n)) return 0;
	if (n < 0) return 0;
	if (n > 1) return 1;
	return n;
}

/**
 * The one-shot prompt sent to the classifier model. Exported so tests
 * can assert wording stability and the smoke dataset in G6.D.3 can use
 * the same prompt at evaluation time.
 *
 * Keep it terse — Haiku-class models charge per-token, and the eight
 * intents fit comfortably in a short instruction.
 */
export const CLASSIFIER_SYSTEM_PROMPT = `You are an intent classifier for a coding-agent router.
Given a user message, output exactly one of these labels (snake_case):
implement, refactor, debug, document, test, explain, review, other.

Rules:
- "implement" = build a new feature or function from scratch.
- "refactor" = restructure existing code without changing behaviour.
- "debug" = diagnose / fix a bug, error, or test failure.
- "document" = write or update docs, comments, README.
- "test" = author tests for existing code.
- "explain" = describe how code works, no edits expected.
- "review" = audit / critique existing code.
- "other" = anything that does not fit the above (greetings, off-topic, ambiguous).

Reply with JSON only: {"intent": "<label>", "confidence": <0..1>}.`;

export function buildUserPayload(prompt: string): string {
	return `User message:\n${prompt}\n\nReturn JSON only.`;
}
