/**
 * Agent Router - Routes tasks to appropriate providers based on role.
 * Handles provider selection, fallback on errors, and token validation.
 * Now supports 15+ models including DeepSeek V4, Kimi K2.6, Qwen 3.6, etc.
 */

import { config, getProviderKey } from "../core/config";
import { ProviderRouter } from "../providers/router";
import {
	getCapabilityScore,
	rankProvidersForTask,
	roleToTaskType,
	selectBestProvider,
} from "./capability-manifest";
import { type CapabilityStats, getDefaultStats } from "./capability-stats";
import { EventLedger } from "./ledger";
import type {
	EventLog,
	EventSeverity,
	ModelCapability,
	ProviderId,
	TaskRole,
} from "./types";
import {
	getBestModelsForRole,
	getModelById,
	MODELS,
	ROLE_FALLBACK_ORDER,
	ROLE_TO_PROVIDER,
} from "./types";

// Re-export types for external use
export type { ModelCapability, ProviderId, TaskRole };

// Token validation map - validates API keys exist before dispatch
const TOKEN_VALIDATORS: Record<ProviderId, () => boolean> = {
	"opencode-go": () => !!getProviderKey("opencode-go"),
	"anthropic-api": () => !!getProviderKey("anthropic-api"),
	"gemini-api": () => !!getProviderKey("gemini-api"),
	deepseek: () => !!getProviderKey("deepseek"),
	"deepseek-v4": () => !!getProviderKey("deepseek"),
	tavily: () => !!getProviderKey("tavily"),
	gemini: () => !!getProviderKey("gemini"),
	"moonshot-k2.5": () => !!getProviderKey("moonshot"),
	"moonshot-k2.6": () => !!getProviderKey("moonshot"),
	"xiaomi-mimo": () => !!getProviderKey("xiaomi"),
	"qwen3.5-plus": () => !!getProviderKey("alibaba"),
	"qwen3.6-plus": () => !!getProviderKey("alibaba"),
	"minimax-m2.5": () => !!getProviderKey("minimax"),
	"minimax-m2.7": () => !!getProviderKey("minimax"),
	"glm-deepinfra": () => !!getProviderKey("deepinfra"),
	"glm-fireworks": () => !!getProviderKey("fireworks"),
	"glm-zai": () => !!getProviderKey("zai"),
	groq: () => !!getProviderKey("groq"),
	"kiro-ai": () => true, // No auth required
	mistral: () => !!getProviderKey("mistral"),
	openai: () => !!getProviderKey("openai"),
	"carnice-9b-local": () => true, // No auth required — local server; reachability is checked at call time
	// CLI drivers: "auth" is whatever the user's installed CLI already
	// has (Claude subscription, ChatGPT/Codex subscription, Google
	// account). We can't probe it from here without spawning the binary,
	// so we declare them available and let `callCliDriver` surface a
	// clean ENOENT/auth error at the call site if not.
	"claude-code-cli": () => true,
	"codex-cli": () => true,
	"gemini-cli": () => true,
};

/**
 * Result of a routeTask call including provider and validation info.
 */
export interface RouteResult {
	provider: ProviderId;
	model: ModelCapability | undefined;
	requiresFallback: boolean;
	fallbackProviders: ProviderId[];
	/**
	 * True when the router picked uniformly at random (5% exploration
	 * branch) instead of the Thompson-Sampling-greedy provider. Surfaced
	 * so the `provider_outcome` ledger event can flag exploration traffic
	 * and `apohara stats` can subtract it from convergence metrics.
	 */
	explored?: boolean;
}

/**
 * Fraction of routing decisions that ignore Thompson Sampling and pick
 * uniformly at random from the valid-token candidates. Guarantees we
 * never lock in on a stale ranking when a provider's quality improves.
 *
 * Set via `APOHARA_ROUTER_EXPLORATION_RATE` (0..1). Default 0.05.
 */
function explorationRate(): number {
	const v = Number(process.env.APOHARA_ROUTER_EXPLORATION_RATE);
	return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.05;
}

/**
 * Module-level RNG used by the Thompson selector + epsilon-greedy
 * exploration branch. Defaults to `Math.random`; tests inject a seeded
 * generator via [`_setRouterRng`] for deterministic assertions.
 */
let _routerRng: () => number = Math.random;
export function _setRouterRng(rng: (() => number) | undefined): void {
	_routerRng = rng ?? Math.random;
}

/**
 * Resolve the primary provider via Thompson Sampling, with a small
 * epsilon-greedy exploration branch. Returns null when no valid-token
 * candidates exist (caller falls through to the legacy capability
 * manifest path).
 */
async function pickViaThompson(
	stats: CapabilityStats,
	candidates: ProviderId[],
	taskType: ReturnType<typeof roleToTaskType>,
): Promise<{ provider: ProviderId; explored: boolean } | null> {
	if (candidates.length === 0) return null;
	if (candidates.length === 1) {
		return { provider: candidates[0], explored: false };
	}
	// Cold start: defer to the capability manifest until at least one
	// candidate has an observation for this task type. Without this
	// guard, the uniform Beta(α₀, β₀) prior collapses to random routing
	// across every token-valid provider (including ones the manifest
	// never intended for this role).
	const observed = await Promise.all(
		candidates.map((p) => stats.get(p, taskType)),
	);
	const hasAny = observed.some(
		(c) => c !== undefined && c.successes + c.failures > 0,
	);
	if (!hasAny) return null;

	const epsilon = explorationRate();
	if (_routerRng() < epsilon) {
		const idx = Math.min(
			candidates.length - 1,
			Math.floor(_routerRng() * candidates.length),
		);
		return { provider: candidates[idx], explored: true };
	}
	const ranked = await stats.rank(candidates, taskType, _routerRng);
	return { provider: ranked[0].provider, explored: false };
}

/**
 * Validates that the required API token exists for a provider.
 * Returns true if token is valid, false otherwise.
 */
export function validateToken(provider: ProviderId): boolean {
	const validator = TOKEN_VALIDATORS[provider];
	if (!validator) {
		console.warn(`No token validator for provider: ${provider}`);
		return false;
	}
	return validator();
}

/**
 * Gets all available providers (those with valid tokens).
 * Useful for debugging and UI display.
 */
export function getAvailableProviders(): ProviderId[] {
	const available: ProviderId[] = [];
	for (const provider of MODELS.map((m) => m.id)) {
		if (validateToken(provider)) {
			available.push(provider);
		}
	}
	return available;
}

/**
 * Gets provider info for display.
 */
export function getProviderInfo(
	provider: ProviderId,
): { name: string; provider: string; strengths: string[] } | undefined {
	const model = getModelById(provider);
	if (!model) return undefined;
	return {
		name: model.name,
		provider: model.provider,
		strengths: model.strengths,
	};
}

/**
 * Logs role assignment and provider selection events to the ledger.
 */
async function logProviderEvent(
	ledger: EventLedger,
	type: string,
	message: string,
	role: TaskRole,
	provider: ProviderId,
	metadata?: EventLog["metadata"],
): Promise<void> {
	const severity: EventSeverity =
		type === "provider_fallback" ? "warning" : "info";
	await ledger.log(
		type,
		{ message, role, provider },
		severity,
		undefined, // taskId handled externally if needed
		{ role, provider, ...metadata },
	);
}

/**
 * Routes a task to the correct provider based on its role.
 * Implements:
 * - Capability manifest consultation for provider selection
 * - Intelligent role-based provider selection using top models
 * - Token validation before dispatch (Decision D006)
 * - Fallback chain activation on 429/timeout
 * - Structured logging to EventLedger
 *
 * @param role - The role of the task (research, planning, execution, verification)
 * @param task - Optional task object for additional context
 * @returns The selected provider ID with model capabilities
 */
export async function routeTask(
	role: TaskRole,
	task?: { id?: string; description?: string },
): Promise<RouteResult> {
	const ledger = new EventLedger();
	const taskId = task?.id;
	const taskType = roleToTaskType(role);

	// Get capability-ranked providers for this task type
	const rankedProviders = rankProvidersForTask(taskType);

	// Find the best provider that has a valid token
	let primaryProvider = ROLE_TO_PROVIDER[role];
	let fallbackOrder = ROLE_FALLBACK_ORDER[role];
	let modelCapability = getModelById(primaryProvider);

	// Consult capability manifest: prioritize higher-scoring providers with valid tokens
	const availableProviders = getAvailableProviders();

	// M013.3 — Thompson Sampling. With 95% probability the pick is the
	// arm with the highest sampled Beta(α₀+succ, β₀+fail) score; with 5%
	// it is uniformly random. When no token-valid candidate exists, fall
	// back to the legacy capability-manifest path so this never blocks
	// startup or first-run scenarios where stats are empty.
	const thompsonPick = await pickViaThompson(
		getDefaultStats(),
		availableProviders,
		taskType,
	);
	let explored = false;
	let chosen: ProviderId | null = null;
	if (thompsonPick && validateToken(thompsonPick.provider)) {
		chosen = thompsonPick.provider;
		explored = thompsonPick.explored;
	} else {
		const bestByCapability = selectBestProvider(availableProviders, taskType);
		if (bestByCapability && validateToken(bestByCapability)) {
			chosen = bestByCapability;
		}
	}
	if (chosen) {
		primaryProvider = chosen;
		modelCapability = getModelById(primaryProvider);
		// Reorder fallback to start after the selected primary
		const remaining = fallbackOrder.filter((p) => p !== primaryProvider);
		fallbackOrder = [primaryProvider, ...remaining];
	}

	// Log role assignment with capability info
	await ledger.log(
		"role_assignment",
		{
			message: `Task assigned to role: ${role} (taskType: ${taskType})`,
			taskId,
			role,
			taskType,
			capabilityScore: getCapabilityScore(primaryProvider, taskType),
			explored,
		},
		"info",
		taskId,
		{ role, provider: primaryProvider },
	);

	// Validate token for primary provider (Decision D006)
	const tokenValid = validateToken(primaryProvider);
	if (!tokenValid) {
		console.warn(
			`⚠ Token validation failed for ${primaryProvider} (role: ${role})`,
		);
		// Find fallback with valid token
		for (const fallbackProvider of fallbackOrder) {
			if (
				fallbackProvider !== primaryProvider &&
				validateToken(fallbackProvider)
			) {
				await logProviderEvent(
					ledger,
					"provider_fallback",
					`Fallback from ${primaryProvider} to ${fallbackProvider} due to invalid token`,
					role,
					fallbackProvider,
					{
						fromProvider: primaryProvider,
						toProvider: fallbackProvider,
						errorReason: "invalid_token",
					},
				);
				return {
					provider: fallbackProvider,
					model: getModelById(fallbackProvider),
					requiresFallback: true,
					fallbackProviders: fallbackOrder,
					explored,
				};
			}
		}
		// No valid fallback, return primary anyway (fail-fast is better)
		console.error(
			`⚠ No valid token found for role ${role}, using primary anyway`,
		);
	}

	// Log provider selection with model info and capability score
	const modelInfo = modelCapability
		? `${modelCapability.name} (${modelCapability.provider})`
		: primaryProvider;
	await logProviderEvent(
		ledger,
		"provider_selected",
		`Provider ${modelInfo} selected for role ${role} (capability: ${getCapabilityScore(primaryProvider, taskType)})`,
		role,
		primaryProvider,
		{
			modelName: modelCapability?.name,
			modelProvider: modelCapability?.provider,
			contextWindow: modelCapability?.contextWindow,
			capabilityScore: getCapabilityScore(primaryProvider, taskType),
		},
	);

	return {
		provider: primaryProvider,
		model: modelCapability,
		requiresFallback: false,
		fallbackProviders: fallbackOrder,
		explored,
	};
}

/**
 * Executes a task with automatic fallback to alternate providers on failure.
 * Uses ProviderRouter's built-in fallback mechanism for 429/timeout errors.
 *
 * @param role - The role of the task
 * @param task - Task object with messages for the LLM
 * @param router - Optional ProviderRouter instance (creates one if not provided)
 * @returns The LLM response from the provider with model info
 */
export async function routeTaskWithFallback(
	role: TaskRole,
	task: {
		id?: string;
		messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
	},
	router?: ProviderRouter,
): Promise<{
	provider: ProviderId;
	model: ModelCapability | undefined;
	response: any;
}> {
	const result = await routeTask(role, task);
	const ledger = new EventLedger();
	const stats = getDefaultStats();

	// Use provided router or create new one
	const providerRouter = router || new ProviderRouter();

	// Attempt with primary provider
	try {
		const response = await providerRouter.completion({
			messages: task.messages,
			provider: result.provider,
		});
		await stats.updateOutcome(result.provider, role, true);
		await ledger.logProviderOutcome(result.provider, role, true, {
			taskId: task.id,
			explored: result.explored,
		});
		return { provider: result.provider, model: result.model, response };
	} catch (error) {
		// Check if error is retryable (429, timeout)
		const isRetryable = isRetryableError(error);
		const primaryErrorMessage =
			error instanceof Error ? error.message : String(error);
		await stats.updateOutcome(result.provider, role, false);
		await ledger.logProviderOutcome(result.provider, role, false, {
			taskId: task.id,
			errorReason: primaryErrorMessage,
			explored: result.explored,
		});
		if (!isRetryable) {
			throw error;
		}

		// Log fallback event
		const errorMessage = primaryErrorMessage;
		await ledger.log(
			"provider_fallback",
			{
				message: `Provider ${result.provider} failed: ${errorMessage}. Trying fallback.`,
				taskId: task.id,
				role,
			},
			"warning",
			task.id,
			{
				role,
				provider: result.provider,
				fromProvider: result.provider,
				toProvider: result.fallbackProviders[1],
				errorReason: errorMessage,
			},
		);

		// Try fallback providers
		for (let i = 1; i < result.fallbackProviders.length; i++) {
			const fallbackProvider = result.fallbackProviders[i];

			// Validate token before trying fallback
			if (!validateToken(fallbackProvider)) {
				console.warn(
					`⚠ Skipping fallback to ${fallbackProvider}: no valid token`,
				);
				continue;
			}

			try {
				const response = await providerRouter.completion({
					messages: task.messages,
					provider: fallbackProvider,
				});

				// Log successful fallback
				await ledger.log(
					"fallback_succeeded",
					{
						message: `Task completed via fallback provider: ${fallbackProvider}`,
						taskId: task.id,
						role,
					},
					"info",
					task.id,
					{
						role,
						provider: fallbackProvider,
						fromProvider: result.provider,
						toProvider: fallbackProvider,
					},
				);

				await stats.updateOutcome(fallbackProvider, role, true);
				await ledger.logProviderOutcome(fallbackProvider, role, true, {
					taskId: task.id,
				});

				return {
					provider: fallbackProvider,
					model: getModelById(fallbackProvider),
					response,
				};
			} catch (fallbackError) {
				const errorMsg =
					fallbackError instanceof Error
						? fallbackError.message
						: String(fallbackError);
				console.warn(`⚠ Fallback to ${fallbackProvider} failed: ${errorMsg}`);
				await stats.updateOutcome(fallbackProvider, role, false);
				await ledger.logProviderOutcome(fallbackProvider, role, false, {
					taskId: task.id,
					errorReason: errorMsg,
				});
			}
		}

		// Log exhaustion
		await ledger.log(
			"task_exhausted",
			{
				message: `All providers exhausted for role ${role}`,
				taskId: task.id,
				role,
			},
			"error",
			task.id,
			{
				role,
				provider: result.provider,
				fallbackProviders: result.fallbackProviders,
			},
		);

		throw error;
	}
}

/**
 * Determines if an error is retryable (429, timeout, network).
 */
function isRetryableError(error: unknown): boolean {
	if (error instanceof Error) {
		const message = error.message.toLowerCase();
		if (message.includes("429") || message.includes("rate limit")) {
			return true;
		}
		if (
			message.includes("timeout") ||
			message.includes("etimedout") ||
			message.includes("econnaborted")
		) {
			return true;
		}
		if (
			message.includes("network") ||
			message.includes("fetch") ||
			message.includes("econnrefused") ||
			message.includes("enotfound")
		) {
			return true;
		}
	}
	return false;
}

// Default export for easy importing
export default {
	routeTask,
	routeTaskWithFallback,
	validateToken,
	getAvailableProviders,
	getProviderInfo,
	getModelById,
	getBestModelsForRole,
	MODELS,
};
