/**
 * Capability Manifest - Scores providers by task type for intelligent routing.
 * Based on public benchmarks (SWE-bench, HumanEval, MBPP) and community evaluations.
 * Scores are normalized 0.0-1.0, with 1.0 being state-of-the-art for that task.
 */

import type { ProviderId, TaskRole } from "./types";

export type TaskType =
	| "research"
	| "planning"
	| "codegen"
	| "debugging"
	| "verification";

/**
 * Capability scores for a single provider across all task types.
 */
export interface ProviderCapability {
	provider: ProviderId;
	scores: Record<TaskType, number>;
	sources: string[]; // Benchmark sources
	lastUpdated: string; // ISO date
}

/**
 * Conservative capability scores based on public benchmarks.
 * These are estimates — actual performance varies by use case.
 */
export const CAPABILITY_MANIFEST: ProviderCapability[] = [
	{
		provider: "groq",
		scores: {
			research: 0.6,
			planning: 0.85,
			codegen: 0.9,
			debugging: 0.85,
			verification: 0.8,
		},
		sources: ["HumanEval", "MBPP", "internal-eval"],
		lastUpdated: "2026-05-01",
	},
	{
		provider: "kiro-ai",
		scores: {
			research: 0.7,
			planning: 0.8,
			codegen: 0.75,
			debugging: 0.7,
			verification: 0.6,
		},
		sources: ["community-eval", "CLAUDE-benchmarks"],
		lastUpdated: "2026-05-01",
	},
	{
		provider: "deepseek",
		scores: {
			research: 0.65,
			planning: 0.8,
			codegen: 0.9,
			debugging: 0.85,
			verification: 0.8,
		},
		sources: ["SWE-bench", "HumanEval", "LiveCodeBench"],
		lastUpdated: "2026-05-01",
	},
	{
		provider: "deepseek-v4",
		scores: {
			research: 0.7,
			planning: 0.85,
			codegen: 0.92,
			debugging: 0.88,
			verification: 0.82,
		},
		sources: ["SWE-bench", "HumanEval", "LiveCodeBench"],
		lastUpdated: "2026-05-01",
	},
	{
		provider: "mistral",
		scores: {
			research: 0.6,
			planning: 0.7,
			codegen: 0.75,
			debugging: 0.7,
			verification: 0.65,
		},
		sources: ["HumanEval", "MBPP", "community-eval"],
		lastUpdated: "2026-05-01",
	},
	{
		provider: "openai",
		scores: {
			research: 0.7,
			planning: 0.85,
			codegen: 0.85,
			debugging: 0.8,
			verification: 0.85,
		},
		sources: ["SWE-bench", "HumanEval", "MBPP"],
		lastUpdated: "2026-05-01",
	},
	{
		provider: "gemini",
		scores: {
			research: 0.75,
			planning: 0.8,
			codegen: 0.82,
			debugging: 0.78,
			verification: 0.75,
		},
		sources: ["HumanEval", "MBPP", "BigCodeBench"],
		lastUpdated: "2026-05-01",
	},
	{
		provider: "tavily",
		scores: {
			research: 0.95,
			planning: 0.3,
			codegen: 0.1,
			debugging: 0.1,
			verification: 0.4,
		},
		sources: ["internal-eval"],
		lastUpdated: "2026-05-01",
	},
	{
		provider: "opencode-go",
		scores: {
			research: 0.55,
			planning: 0.75,
			codegen: 0.88,
			debugging: 0.82,
			verification: 0.78,
		},
		sources: ["HumanEval", "MBPP"],
		lastUpdated: "2026-05-01",
	},
	{
		provider: "moonshot-k2.6",
		scores: {
			research: 0.7,
			planning: 0.85,
			codegen: 0.88,
			debugging: 0.84,
			verification: 0.8,
		},
		sources: ["HumanEval", "LiveCodeBench"],
		lastUpdated: "2026-05-01",
	},
	{
		provider: "qwen3.6-plus",
		scores: {
			research: 0.65,
			planning: 0.8,
			codegen: 0.85,
			debugging: 0.8,
			verification: 0.75,
		},
		sources: ["HumanEval", "MBPP", "SWE-bench"],
		lastUpdated: "2026-05-01",
	},
	{
		provider: "anthropic-api",
		scores: {
			research: 0.8,
			planning: 0.95,
			codegen: 0.97,
			debugging: 0.95,
			verification: 0.93,
		},
		sources: ["community-eval"],
		lastUpdated: "2026-05-02",
	},
	{
		provider: "gemini-api",
		scores: {
			research: 0.85,
			planning: 0.9,
			codegen: 0.92,
			debugging: 0.88,
			verification: 0.87,
		},
		sources: ["community-eval"],
		lastUpdated: "2026-05-02",
	},
	{
		provider: "moonshot-k2.5",
		scores: {
			research: 0.7,
			planning: 0.82,
			codegen: 0.88,
			debugging: 0.82,
			verification: 0.78,
		},
		sources: ["community-eval"],
		lastUpdated: "2026-05-02",
	},
	{
		provider: "minimax-m2.5",
		scores: {
			research: 0.65,
			planning: 0.78,
			codegen: 0.82,
			debugging: 0.78,
			verification: 0.72,
		},
		sources: ["community-eval"],
		lastUpdated: "2026-05-02",
	},
	{
		provider: "minimax-m2.7",
		scores: {
			research: 0.68,
			planning: 0.82,
			codegen: 0.86,
			debugging: 0.82,
			verification: 0.76,
		},
		sources: ["community-eval"],
		lastUpdated: "2026-05-02",
	},
	{
		provider: "xiaomi-mimo",
		scores: {
			research: 0.55,
			planning: 0.65,
			codegen: 0.72,
			debugging: 0.68,
			verification: 0.62,
		},
		sources: ["community-eval"],
		lastUpdated: "2026-05-02",
	},
	{
		provider: "glm-deepinfra",
		scores: {
			research: 0.6,
			planning: 0.72,
			codegen: 0.78,
			debugging: 0.72,
			verification: 0.68,
		},
		sources: ["community-eval"],
		lastUpdated: "2026-05-02",
	},
	{
		provider: "glm-fireworks",
		scores: {
			research: 0.6,
			planning: 0.72,
			codegen: 0.78,
			debugging: 0.72,
			verification: 0.68,
		},
		sources: ["community-eval"],
		lastUpdated: "2026-05-02",
	},
	{
		provider: "glm-zai",
		scores: {
			research: 0.6,
			planning: 0.72,
			codegen: 0.78,
			debugging: 0.72,
			verification: 0.68,
		},
		sources: ["community-eval"],
		lastUpdated: "2026-05-02",
	},
	{
		provider: "qwen3.5-plus",
		scores: {
			research: 0.68,
			planning: 0.82,
			codegen: 0.87,
			debugging: 0.83,
			verification: 0.78,
		},
		sources: ["community-eval"],
		lastUpdated: "2026-05-02",
	},
	// CLI drivers (M013.3 partial). Scores match the underlying model
	// families: claude-code-cli ≈ Claude Sonnet 4, codex-cli ≈ GPT-4 /
	// gpt-4o, gemini-cli ≈ Gemini 2.x. Scores are deliberately a hair
	// HIGHER than the API equivalents so capability-driven selection
	// prefers the subscription path (no key, no TOS issue, no per-call
	// cost) when both are available.
	{
		provider: "claude-code-cli",
		scores: {
			research: 0.78,
			planning: 0.94,
			codegen: 0.93,
			debugging: 0.92,
			verification: 0.92,
		},
		sources: ["anthropic-claude-sonnet-4", "subscription-no-key"],
		lastUpdated: "2026-05-12",
	},
	{
		provider: "codex-cli",
		scores: {
			research: 0.75,
			planning: 0.9,
			codegen: 0.91,
			debugging: 0.88,
			verification: 0.86,
		},
		sources: ["openai-gpt-4o", "subscription-no-key"],
		lastUpdated: "2026-05-12",
	},
	{
		provider: "gemini-cli",
		scores: {
			research: 0.82,
			planning: 0.87,
			codegen: 0.83,
			debugging: 0.82,
			verification: 0.9, // Stronger on audit/review per Gemini's RLHF tilt
		},
		sources: ["google-gemini-2.x", "subscription-no-key"],
		lastUpdated: "2026-05-12",
	},
];

/**
 * Gets the capability score for a provider on a specific task type.
 */
export function getCapabilityScore(
	provider: ProviderId,
	taskType: TaskType,
): number {
	const entry = CAPABILITY_MANIFEST.find((c) => c.provider === provider);
	return entry?.scores[taskType] ?? 0.5;
}

/**
 * Gets all capability data for a provider.
 */
export function getProviderCapability(
	provider: ProviderId,
): ProviderCapability | undefined {
	return CAPABILITY_MANIFEST.find((c) => c.provider === provider);
}

/**
 * Ranks providers for a given task type, sorted by capability score (descending).
 * Only returns providers with scores above the minimum threshold.
 */
export function rankProvidersForTask(
	taskType: TaskType,
	minScore: number = 0.0,
): Array<{ provider: ProviderId; score: number }> {
	return CAPABILITY_MANIFEST.map((c) => ({
		provider: c.provider,
		score: c.scores[taskType],
	}))
		.filter((c) => c.score >= minScore)
		.sort((a, b) => b.score - a.score);
}

/**
 * Selects the best provider for a task type from a list of available providers.
 */
export function selectBestProvider(
	availableProviders: ProviderId[],
	taskType: TaskType,
): ProviderId | null {
	const ranked = rankProvidersForTask(taskType);
	for (const { provider } of ranked) {
		if (availableProviders.includes(provider)) {
			return provider;
		}
	}
	return null;
}

/**
 * Maps TaskRole to TaskType for capability lookup.
 */
export function roleToTaskType(role: TaskRole): TaskType {
	switch (role) {
		case "research":
			return "research";
		case "planning":
			return "planning";
		case "execution":
			return "codegen";
		case "verification":
			return "verification";
		default:
			return "codegen";
	}
}

export default {
	getCapabilityScore,
	getProviderCapability,
	rankProvidersForTask,
	selectBestProvider,
	roleToTaskType,
	CAPABILITY_MANIFEST,
};
