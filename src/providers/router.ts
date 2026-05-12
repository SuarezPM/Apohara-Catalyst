import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getProviderKey } from "../core/config";
import { ContextForgeClient } from "../core/contextforge-client";
import type { EventLedger } from "../core/ledger";
import type {
	EventLog,
	EventSeverity,
	ProviderErrorClass,
	ProviderId,
} from "../core/types";
import {
	type CliDriverConfig,
	callCliDriver,
	loadCliDriverRegistry,
} from "./cli-driver";

export interface LLMMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

export interface LLMRequest {
	messages: LLMMessage[];
	provider?: ProviderId;
	signal?: AbortSignal;
	/**
	 * Optional agent identifier. When set AND ContextForge is enabled
	 * (CONTEXTFORGE_ENABLED=1), the router asks the sidecar to optimize
	 * the context before dispatching to the provider (M015.2).
	 */
	agentId?: string;
}

export interface LLMResponse {
	content: string;
	provider: ProviderId;
	model: string;
	usage: {
		promptTokens: number;
		completionTokens: number;
		totalTokens: number;
	};
}

export interface RouterConfig {
	// OpenCode
	opencodeApiKey?: string;
	// Anthropic direct API
	anthropicApiKey?: string;
	// Google AI Studio (direct)
	geminiApiKeyDirect?: string;
	// DeepSeek
	deepseekApiKey?: string;
	// Google (Gemini)
	geminiApiKey?: string;
	// Tavily - Real-time web search (replaces Perplexity for research)
	tavilyApiKey?: string;
	// Moonshot (Kimi)
	moonshotApiKey?: string;
	// Xiaomi (MiMo)
	xiaomiApiKey?: string;
	// Alibaba (Qwen)
	alibabaApiKey?: string;
	// MiniMax
	minimaxApiKey?: string;
	// DeepInfra
	deepinfraApiKey?: string;
	// Fireworks
	fireworksApiKey?: string;
	// Z.ai GLM
	zaiApiKey?: string;
	// Groq - Ultra-fast inference
	groqApiKey?: string;
	// Kiro AI - Free tier, no auth required
	kiroAiApiKey?: string;
	// Mistral
	mistralApiKey?: string;
	// OpenAI
	openaiApiKey?: string;

	cooldownMinutes?: number;
	maxFailuresBeforeCooldown?: number;
	simulateFailure?: boolean;
	// Phase 4: pass an EventLedger so llm_request events join the chained run ledger.
	eventLedger?: EventLedger;
	// Phase 4.4: when true, every provider call sets temperature:0 for byte-identical replay.
	replayMode?: boolean;
}

// Re-export ProviderId from types for external use
export type { ProviderId } from "../core/types";

/**
 * Provider API endpoints - grouped by provider
 */
const API_ENDPOINTS = {
	// OpenCode - Anthropic Messages API format
	"opencode-go": "https://api.opencode.ai/v1/messages",
	// Anthropic direct API
	"anthropic-api": "https://api.anthropic.com/v1/messages",
	// Google AI Studio
	"gemini-api": "https://generativelanguage.googleapis.com/v1beta/models",
	// DeepSeek
	deepseek: "https://api.deepseek.com/v1/chat/completions",
	"deepseek-v4": "https://api.deepseek.com/v1/chat/completions",
	// Google
	gemini:
		"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
	// Tavily - Real-time web search for AI agents
	tavily: "https://api.tavily.com/search",
	// Moonshot (Kimi)
	"moonshot-k2.5": "https://api.moonshot.cn/v1/chat/completions",
	"moonshot-k2.6": "https://api.moonshot.cn/v1/chat/completions",
	// Xiaomi (MiMo)
	"xiaomi-mimo": "https://api.mimi.finance/v1/chat/completions",
	// Alibaba (Qwen)
	"qwen3.5-plus":
		"https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation",
	"qwen3.6-plus":
		"https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation",
	// MiniMax
	"minimax-m2.5": "https://api.minimax.chat/v1/text/chatcompletion_v2",
	"minimax-m2.7": "https://api.minimax.chat/v1/text/chatcompletion_v2",
	// DeepInfra
	"glm-deepinfra": "https://api.deepinfra.com/v1/chat/completions",
	// Fireworks
	"glm-fireworks": "https://api.fireworks.ai/v1/chat/completions",
	// Groq - OpenAI-compatible ultra-fast inference
	groq: "https://api.groq.com/openai/v1/chat/completions",
	// Kiro AI - Free tier, no auth required
	"kiro-ai": "https://api.kiro.ai/v1/chat/completions",
	// Mistral
	mistral: "https://api.mistral.ai/v1/chat/completions",
	// OpenAI
	openai: "https://api.openai.com/v1/chat/completions",
	// Carnice-9b local GPU server (llama-cpp-python OpenAI-compat) — M015 local-first path.
	// Override base via env: CARNICE_BASE_URL=http://other-host:8000/v1/chat/completions
	"carnice-9b-local":
		process.env.CARNICE_BASE_URL ?? "http://localhost:8000/v1/chat/completions",
};

/**
 * Model names for each provider
 */
const MODEL_NAMES: Record<ProviderId, string> = {
	"opencode-go": "claude-sonnet-4-20250514",
	"anthropic-api": "claude-sonnet-4-20250514",
	"gemini-api": "gemini-2.0-flash",
	deepseek: "deepseek-coder",
	"deepseek-v4": "deepseek-chat",
	gemini: "gemini-2.0-flash",
	tavily: "tavily-search",
	"moonshot-k2.5": "kimi-k2.5",
	"moonshot-k2.6": "kimi-k2.6",
	"xiaomi-mimo": "MiMo-V2-8B",
	"qwen3.5-plus": "qwen-plus",
	"qwen3.6-plus": "qwen-plus",
	"minimax-m2.5": "MiniMax-M2.5",
	"minimax-m2.7": "MiniMax-M2.7",
	"glm-deepinfra": "THUDM/glm-4-9b-chat",
	"glm-fireworks": "THUDM/glm-4-9b-chat",
	"glm-zai": "THUDM/glm-4-9b-chat",
	groq: "llama-3.3-70b-versatile",
	"kiro-ai": "claude-sonnet-4-20250514",
	mistral: "mistral-small-latest",
	openai: "gpt-4o-mini",
	"carnice-9b-local": "carnice-9b",
	"claude-code-cli": "claude-sonnet-4-via-cli",
	"codex-cli": "gpt-via-codex-cli",
	"gemini-cli": "gemini-via-cli",
};

/**
 * Per-provider health record.
 *
 * M018.D — Pattern D extends this with auth-aware fallback fields:
 *   - lastErrorClass: classification of the most recent failure
 *   - needsAuthRefresh: set when AUTH_FAILURE detected (1h cooldown)
 *   - retryAfterMs: parsed from Retry-After header on RATE_LIMIT
 *   - cooldownExpiresAt: absolute timestamp when isOnCooldown should clear
 */
interface ProviderHealth {
	failureCount: number;
	lastFailureTime: number | null;
	isOnCooldown: boolean;
	lastErrorClass: ProviderErrorClass | null;
	needsAuthRefresh: boolean;
	retryAfterMs: number | null;
	cooldownExpiresAt: number | null;
}

/**
 * M018.D — Per-class cooldown defaults (in ms).
 * Hard cap on AUTH_FAILURE = 1h is overridable via env (mitigation per plan §risks).
 */
const COOLDOWN_AUTH_MS = (() => {
	const env = Number(process.env.APOHARA_COOLDOWN_AUTH_MS);
	return Number.isFinite(env) && env > 0 ? env : 60 * 60 * 1000; // 1h
})();
const COOLDOWN_RATE_LIMIT_DEFAULT_MS = 5 * 60 * 1000; // 5min
const COOLDOWN_NETWORK_MS = 30 * 1000; // 30s
const COOLDOWN_MODEL_ERROR_MS = 60 * 1000; // 1min
const NETWORK_MAX_RETRIES = 3;

/**
 * M018.D — Classifies an arbitrary thrown error into one of 4 provider error
 * classes. Inspects HTTP status codes embedded in error messages (the
 * provider call sites construct errors like "X API Error: 401 Unauthorized")
 * plus common network error names. Defaults to MODEL_ERROR for anything that
 * doesn't match a more specific class.
 */
export function classifyError(err: unknown): ProviderErrorClass {
	if (!(err instanceof Error)) return "MODEL_ERROR";
	const msg = err.message.toLowerCase();

	// AUTH_FAILURE — 401/403 or "invalid api key" / "unauthorized" / "forbidden"
	if (
		/\b(401|403)\b/.test(msg) ||
		msg.includes("unauthorized") ||
		msg.includes("forbidden") ||
		msg.includes("invalid api key") ||
		msg.includes("invalid_api_key") ||
		msg.includes("authentication") ||
		msg.includes("api key not configured") ||
		msg.includes("api key format")
	) {
		return "AUTH_FAILURE";
	}

	// RATE_LIMIT — 429 or "rate limit"
	if (/\b429\b/.test(msg) || msg.includes("rate limit")) {
		return "RATE_LIMIT";
	}

	// NETWORK — connection / timeout / fetch failures
	if (
		msg.includes("econnrefused") ||
		msg.includes("enotfound") ||
		msg.includes("etimedout") ||
		msg.includes("econnaborted") ||
		msg.includes("econnreset") ||
		msg.includes("timeout") ||
		msg.includes("network") ||
		msg.includes("unreachable") ||
		msg.includes("fetch failed")
	) {
		return "NETWORK";
	}

	// MODEL_ERROR — 5xx, malformed JSON, anything else
	return "MODEL_ERROR";
}

/**
 * M018.D — Extracts the Retry-After header value (in ms) from an Error whose
 * message includes a "Retry-After: <n>" hint or a "retry after <n>s" phrase.
 * Returns null if no parsable hint is found.
 *
 * Note: Provider call sites currently don't propagate Retry-After to the
 * Error message. This helper is the hook point — when a future PR threads
 * the header through, this parser will pick it up automatically.
 */
export function parseRetryAfterMs(err: unknown): number | null {
	if (!(err instanceof Error)) return null;
	const m =
		err.message.match(/retry[- ]after[:= ]\s*(\d+(?:\.\d+)?)/i) ||
		err.message.match(/retry after\s+(\d+(?:\.\d+)?)\s*s/i);
	if (!m) return null;
	const seconds = Number(m[1]);
	return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}

/**
 * Routes requests to LLM providers with automatic fallback on failures.
 * Supports 15+ models including DeepSeek V4, Kimi K2.6, Qwen 3.6, MiniMax, etc.
 * Tracks provider health and implements cooldown mechanism after consecutive failures.
 */
export class ProviderRouter {
	// Provider endpoints
	private readonly API_URLS = API_ENDPOINTS;

	// API Keys
	private opencodeApiKey: string;
	private anthropicApiKey: string;
	private geminiApiKeyDirect: string;
	private deepseekApiKey: string;
	private geminiApiKey: string;
	private tavilyApiKey: string;
	private moonshotApiKey: string;
	private xiaomiApiKey: string;
	private alibabaApiKey: string;
	private minimaxApiKey: string;
	private deepinfraApiKey: string;
	private fireworksApiKey: string;
	private zaiApiKey: string;
	private groqApiKey: string;
	// kiro-ai is auth-free in practice — the API key is accepted but the
	// service treats requests as `anonymous`. We keep the cfg option for
	// forward compat but no longer store the key, which silenced a
	// noUnusedLocals warning.
	private mistralApiKey: string;
	private openaiApiKey: string;

	// Health tracking per provider
	private providerHealth: Map<ProviderId, ProviderHealth> = new Map();

	// Configuration
	private readonly cooldownMinutes: number;
	private readonly maxFailuresBeforeCooldown: number;

	// Event ledger for fallback events
	private ledgerPath: string;
	private ledgerInitialized = false;
	// Optional shared chained ledger for llm_request events (Phase 4)
	private eventLedger?: EventLedger;
	// M015.2 — optional ContextForge sidecar client. `null` when disabled.
	private contextforge: ContextForgeClient | null = null;
	// Phase 4.4: forces temperature:0 on every provider call for replay determinism
	public readonly replayMode: boolean;

	// Simulate failure flag for demo/testing
	private simulateFailure = false;
	private failureSimulated = false;

	constructor(cfg?: RouterConfig) {
		// Initialize all API keys
		this.opencodeApiKey =
			cfg?.opencodeApiKey || getProviderKey("opencode-go") || "";
		this.anthropicApiKey =
			cfg?.anthropicApiKey || getProviderKey("anthropic-api") || "";
		this.geminiApiKeyDirect =
			cfg?.geminiApiKeyDirect || getProviderKey("gemini-api") || "";
		this.deepseekApiKey =
			cfg?.deepseekApiKey || getProviderKey("deepseek") || "";
		this.geminiApiKey = cfg?.geminiApiKey || getProviderKey("gemini") || "";
		this.tavilyApiKey = cfg?.tavilyApiKey || getProviderKey("tavily") || "";
		this.moonshotApiKey =
			cfg?.moonshotApiKey || getProviderKey("moonshot") || "";
		this.xiaomiApiKey = cfg?.xiaomiApiKey || getProviderKey("xiaomi") || "";
		this.alibabaApiKey = cfg?.alibabaApiKey || getProviderKey("alibaba") || "";
		this.minimaxApiKey = cfg?.minimaxApiKey || getProviderKey("minimax") || "";
		this.deepinfraApiKey =
			cfg?.deepinfraApiKey || getProviderKey("deepinfra") || "";
		this.fireworksApiKey =
			cfg?.fireworksApiKey || getProviderKey("fireworks") || "";
		this.zaiApiKey = cfg?.zaiApiKey || getProviderKey("zai") || "";
		this.groqApiKey = cfg?.groqApiKey || getProviderKey("groq") || "";
		this.mistralApiKey = cfg?.mistralApiKey || getProviderKey("mistral") || "";
		this.openaiApiKey = cfg?.openaiApiKey || getProviderKey("openai") || "";

		this.cooldownMinutes = cfg?.cooldownMinutes ?? 5;
		this.maxFailuresBeforeCooldown = cfg?.maxFailuresBeforeCooldown ?? 3;
		this.simulateFailure = cfg?.simulateFailure ?? false;
		this.eventLedger = cfg?.eventLedger;
		this.replayMode = cfg?.replayMode ?? false;
		// M015.2 — opt-in ContextForge sidecar. Returns null unless
		// CONTEXTFORGE_ENABLED=1 in env. The chained ledger (if any) is
		// reused so the sidecar's events join the same hash chain.
		this.contextforge = ContextForgeClient.fromEnv(cfg?.eventLedger);

		// Initialize health tracking for each provider
		const allProviders: ProviderId[] = [
			"opencode-go",
			"anthropic-api",
			"gemini-api",
			"deepseek",
			"deepseek-v4",
			"gemini",
			"tavily",
			"moonshot-k2.5",
			"moonshot-k2.6",
			"xiaomi-mimo",
			"qwen3.5-plus",
			"qwen3.6-plus",
			"minimax-m2.5",
			"minimax-m2.7",
			"glm-deepinfra",
			"glm-fireworks",
			"glm-zai",
			"groq",
			"kiro-ai",
			"mistral",
			"openai",
		];

		for (const provider of allProviders) {
			this.providerHealth.set(provider, {
				failureCount: 0,
				lastFailureTime: null,
				isOnCooldown: false,
				lastErrorClass: null,
				needsAuthRefresh: false,
				retryAfterMs: null,
				cooldownExpiresAt: null,
			});
		}

		// Initialize ledger path
		const runId = new Date().toISOString().replace(/[:.]/g, "-");
		this.ledgerPath = join(process.cwd(), ".events", `run-${runId}.jsonl`);
	}

	/**
	 * Initializes the ledger directory.
	 */
	private async initLedger(): Promise<void> {
		if (this.ledgerInitialized) return;
		await mkdir(dirname(this.ledgerPath), { recursive: true });
		this.ledgerInitialized = true;
	}

	/**
	 * Logs an event to the ledger for fallback notifications.
	 */
	private async logEvent(
		type: string,
		payload: Record<string, unknown>,
		severity: EventSeverity = "info",
		metadata?: EventLog["metadata"],
	): Promise<void> {
		await this.initLedger();

		const event: EventLog = {
			id: randomUUID(),
			timestamp: new Date().toISOString(),
			type,
			severity,
			payload,
			metadata,
		};

		const line = `${JSON.stringify(event)}\n`;
		await appendFile(this.ledgerPath, line, "utf-8");

		// Also log to console for real-time visibility
		const consoleMsg = `[${type.toUpperCase()}] ${payload.message || JSON.stringify(payload)}`;
		if (severity === "warning") {
			console.warn(consoleMsg);
		} else if (severity === "error") {
			console.error(consoleMsg);
		} else {
			console.log(consoleMsg);
		}
	}

	/**
	 * Records a failure for a provider and applies cooldown.
	 *
	 * M018.D — Pattern D: the cooldown duration now depends on the error
	 * class (caller passes the classification or it's derived from the
	 * error). The legacy `failureCount >= maxFailuresBeforeCooldown` gate
	 * still applies for NETWORK / MODEL_ERROR; AUTH_FAILURE and RATE_LIMIT
	 * cool down immediately on the first occurrence because retrying them
	 * without external action (key rotation, header wait) cannot succeed.
	 */
	private async recordProviderFailure(
		provider: ProviderId,
		errorClass?: ProviderErrorClass,
		retryAfterMs?: number | null,
	): Promise<void> {
		const health = this.providerHealth.get(provider);
		if (!health) return;

		health.failureCount++;
		health.lastFailureTime = Date.now();
		if (errorClass) health.lastErrorClass = errorClass;
		health.retryAfterMs = retryAfterMs ?? null;
		health.needsAuthRefresh = errorClass === "AUTH_FAILURE";

		// Decide cooldown duration based on error class.
		// AUTH_FAILURE and RATE_LIMIT cooldown immediately; NETWORK and
		// MODEL_ERROR follow the legacy threshold so transient blips don't
		// instantly lock out a provider.
		let cooldownMs: number | null = null;
		let immediate = false;
		if (errorClass === "AUTH_FAILURE") {
			cooldownMs = COOLDOWN_AUTH_MS;
			immediate = true;
		} else if (errorClass === "RATE_LIMIT") {
			cooldownMs = retryAfterMs ?? COOLDOWN_RATE_LIMIT_DEFAULT_MS;
			immediate = true;
		} else if (errorClass === "NETWORK") {
			if (health.failureCount >= NETWORK_MAX_RETRIES) {
				cooldownMs = COOLDOWN_NETWORK_MS;
			}
		} else if (errorClass === "MODEL_ERROR") {
			if (health.failureCount >= this.maxFailuresBeforeCooldown) {
				cooldownMs = COOLDOWN_MODEL_ERROR_MS;
			}
			// MODEL_ERROR also surfaces a ledger warning every time (per plan §D).
			await this.logEvent(
				"provider_model_error",
				{
					provider,
					failureCount: health.failureCount,
					message: `Provider ${provider} returned a model-class error`,
				},
				"warning",
				{ provider, errorClass },
			);
		} else if (health.failureCount >= this.maxFailuresBeforeCooldown) {
			// Legacy path: no errorClass passed → use legacy cooldownMinutes.
			cooldownMs = this.cooldownMinutes * 60 * 1000;
		}

		if (cooldownMs == null) return;

		health.isOnCooldown = true;
		health.cooldownExpiresAt = Date.now() + cooldownMs;

		await this.logEvent(
			"fallback_cooldown",
			{
				provider,
				failureCount: health.failureCount,
				cooldownMs,
				errorClass: errorClass ?? null,
				needsAuthRefresh: health.needsAuthRefresh,
				immediate,
			},
			"warning",
			{ provider, errorClass },
		);

		// Schedule cooldown removal.
		setTimeout(() => {
			const h = this.providerHealth.get(provider);
			if (!h) return;
			h.isOnCooldown = false;
			h.cooldownExpiresAt = null;
			h.failureCount = 0;
			h.retryAfterMs = null;
			// needsAuthRefresh persists across the cooldown expiry — only a
			// success or explicit `apohara providers reset` clears it.
			this.logEvent(
				"cooldown_expired",
				{
					provider,
					message: `Provider ${provider} cooldown expired, ready for requests`,
				},
				"info",
				{ provider },
			);
		}, cooldownMs);
	}

	/**
	 * Records a success for a provider (resets failure count).
	 * M018.D — also clears auth-refresh flag, retry-after, and last error class.
	 */
	private recordProviderSuccess(provider: ProviderId): void {
		const health = this.providerHealth.get(provider);
		if (health) {
			health.failureCount = 0;
			health.isOnCooldown = false;
			health.cooldownExpiresAt = null;
			health.needsAuthRefresh = false;
			health.retryAfterMs = null;
			health.lastErrorClass = null;
		}
	}

	/**
	 * Gets the next available provider using round-robin fallback.
	 * Skips providers on cooldown.
	 * Prioritizes more capable models in the fallback chain.
	 */
	public fallback(fromProvider?: ProviderId): ProviderId {
		// Priority order: most capable first, then fallbacks
		const providers: ProviderId[] = [
			// Paid API providers first (highest quality)
			"anthropic-api",
			"gemini-api",
			// Execution role - most powerful coding models first
			"groq",
			"deepseek-v4",
			"kiro-ai",
			"openai",
			"moonshot-k2.6",
			"qwen3.6-plus",
			"opencode-go",
			"minimax-m2.7",
			// Planning/Research
			"mistral",
			"moonshot-k2.5",
			"gemini",
			"tavily",
			"qwen3.5-plus",
			// Legacy fallbacks
			"deepseek",
			"glm-deepinfra",
			"glm-fireworks",
			"glm-zai",
			"xiaomi-mimo",
			"minimax-m2.5",
		];

		// Try the other provider first (round-robin)
		const startIdx = fromProvider
			? providers.indexOf(fromProvider) + 1
			: Math.floor(Math.random() * providers.length);

		for (let i = 0; i < providers.length; i++) {
			const idx = (startIdx + i) % providers.length;
			const provider = providers[idx];
			const health = this.providerHealth.get(provider);

			if (health && !health.isOnCooldown) {
				return provider;
			}
		}

		// If all providers are on cooldown, return the first one anyway
		// (fail-fast is better than infinite wait)
		return providers[0];
	}

	/**
	 * Checks if a provider is currently on cooldown.
	 */
	public isOnCooldown(provider: ProviderId): boolean {
		const health = this.providerHealth.get(provider);
		return health?.isOnCooldown ?? false;
	}

	/**
	 * Gets the failure count for a provider.
	 */
	public getFailureCount(provider: ProviderId): number {
		return this.providerHealth.get(provider)?.failureCount ?? 0;
	}

	/**
	 * M018.D — Returns a snapshot of a provider's full health record.
	 * Used by `apohara stats` to render the `last_err` column and by the
	 * future auth-refresh UI to surface `needsAuthRefresh`.
	 *
	 * Returns null when the provider is unknown to this router instance.
	 */
	public getProviderHealth(provider: ProviderId): {
		failureCount: number;
		lastFailureTime: number | null;
		isOnCooldown: boolean;
		lastErrorClass: ProviderErrorClass | null;
		needsAuthRefresh: boolean;
		retryAfterMs: number | null;
		cooldownExpiresAt: number | null;
	} | null {
		const h = this.providerHealth.get(provider);
		if (!h) return null;
		return {
			failureCount: h.failureCount,
			lastFailureTime: h.lastFailureTime,
			isOnCooldown: h.isOnCooldown,
			lastErrorClass: h.lastErrorClass,
			needsAuthRefresh: h.needsAuthRefresh,
			retryAfterMs: h.retryAfterMs,
			cooldownExpiresAt: h.cooldownExpiresAt,
		};
	}

	/**
	 * Determines if an error is retryable (429, timeout, network error).
	 */
	private isRetryableError(error: Error | unknown): boolean {
		if (error instanceof Error) {
			const message = error.message.toLowerCase();
			// Check for rate limit (429)
			if (message.includes("429") || message.includes("rate limit")) {
				return true;
			}
			// Check for timeout
			if (
				message.includes("timeout") ||
				message.includes("etimedout") ||
				message.includes("econnaborted")
			) {
				return true;
			}
			// Check for network errors
			if (
				message.includes("network") ||
				message.includes("fetch") ||
				message.includes("ECONNREFUSED") ||
				message.includes("ENOTFOUND")
			) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Routes the request to the specified provider with automatic fallback.
	 * If the request fails due to 429 or timeout, tries another provider.
	 */
	public async completion(req: LLMRequest): Promise<LLMResponse> {
		const preferredProvider = req.provider || "opencode-go";
		let currentProvider = preferredProvider;
		let lastError: Error | unknown = null;

		// Log provider selection for observability
		await this.logEvent(
			"provider_selected",
			{
				provider: currentProvider,
				message: `Routing request to ${currentProvider}`,
			},
			"info",
			{ provider: currentProvider },
		);

		// M015.2 — best-effort context optimization via ContextForge sidecar.
		// Only runs when the caller supplied an agentId AND CONTEXTFORGE_ENABLED=1.
		// On any failure (timeout, 503 passthrough, non-2xx, parse) the optimize()
		// call returns null and we proceed with the original messages — sidecar
		// failure CANNOT block a real LLM call.
		if (req.agentId && this.contextforge) {
			const lastUserIdx = this.findLastUserMessageIndex(req.messages);
			if (lastUserIdx >= 0) {
				const original = req.messages[lastUserIdx].content;
				const decision = await this.contextforge.optimize(
					req.agentId,
					original,
				);
				if (decision && decision.final_context && decision.tokens_saved > 0) {
					// Substitute only the last user message's content. The system
					// prompt and role structure are preserved so the provider sees
					// the same message shape it always does.
					req = {
						...req,
						messages: req.messages.map((m, i) =>
							i === lastUserIdx ? { ...m, content: decision.final_context } : m,
						),
					};
				}
			}
		}

		// Try up to 2 providers (original + fallback)
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				const response = await this.callProvider(currentProvider, req.messages);

				// Success - record and return
				this.recordProviderSuccess(currentProvider);
				return response;
			} catch (error) {
				lastError = error;
				const isRetryable = this.isRetryableError(error);
				// M018.D — classify the error and feed it into the cooldown
				// machinery so the right policy applies (auth vs rate vs net vs model).
				const errorClass = classifyError(error);
				const retryAfterMs = parseRetryAfterMs(error);

				// Always record the failure for health tracking
				await this.recordProviderFailure(
					currentProvider,
					errorClass,
					retryAfterMs,
				);

				// Only try fallback on attempt 0 if error is retryable (429, timeout, network)
				// For non-retryable errors (500, 401), we record but don't fallback
				if (isRetryable && attempt === 0) {
					// Log the fallback event
					await this.logEvent(
						"provider_fallback",
						{
							message: `Provider ${currentProvider} failed with retryable error, trying next provider`,
							fromProvider: currentProvider,
							errorClass,
							error: error instanceof Error ? error.message : String(error),
						},
						"warning",
						{ provider: currentProvider, errorClass },
					);

					// Get next available provider
					const nextProvider = this.fallback(currentProvider);

					// Check if we've exhausted all providers
					if (nextProvider === currentProvider) {
						await this.logEvent(
							"task_exhausted",
							{
								message: "All providers failed or unavailable",
								providers: Array.from(this.providerHealth.keys()),
							},
							"error",
						);
						throw error;
					}

					currentProvider = nextProvider;
				} else {
					// Non-retryable error, or retry on attempt 1, or no fallback available
					throw error;
				}
			}
		}

		// Should not reach here, but just in case
		throw lastError || new Error("Provider routing exhausted");
	}

	/**
	 * Phase 4.4: in replay mode, force temperature:0 on every OpenAI-compatible request body.
	 * Returns the body unchanged otherwise.
	 *
	 * Coverage: applied to opencode, anthropic-api, deepseek, openai. The remaining
	 * OpenAI-compatible providers (zai, moonshot, qwen, minimax, deepinfra, fireworks,
	 * groq, kiro-ai, mistral, deepseek-v4) and Gemini (uses generationConfig.temperature)
	 * still build their bodies without this wrapper — extending coverage is mechanical
	 * but mostly one-liner edits per call site. Replay against an uncovered provider
	 * silently runs at default temperature.
	 */
	/** Index of the last user-role message, or -1 if none. M015.2 helper. */
	private findLastUserMessageIndex(messages: LLMMessage[]): number {
		for (let i = messages.length - 1; i >= 0; i--) {
			if (messages[i].role === "user") return i;
		}
		return -1;
	}

	private withReplayDefaults<T extends Record<string, unknown>>(
		body: T,
	): T & { temperature?: 0 } {
		if (!this.replayMode) return body;
		return { ...body, temperature: 0 };
	}

	/**
	 * Phase 4 prereq: log the LLM request payload to the chained ledger so replay can
	 * reconstruct calls. No-op if no eventLedger was provided.
	 */
	private async logLLMRequest(
		provider: ProviderId,
		messages: LLMMessage[],
	): Promise<void> {
		if (!this.eventLedger) return;
		await this.eventLedger.log("llm_request", {
			provider,
			model: MODEL_NAMES[provider] ?? null,
			messages,
		});
	}

	/**
	 * Calls a specific provider with the given messages.
	 */
	private async callProvider(
		provider: ProviderId,
		messages: LLMMessage[],
	): Promise<LLMResponse> {
		await this.logLLMRequest(provider, messages);
		switch (provider) {
			case "opencode-go":
				return this.callOpenCode(messages);
			case "anthropic-api":
				return this.callAnthropicApi(messages);
			case "gemini-api":
				return this.callGeminiApi(messages);
			case "deepseek":
				return this.callDeepSeek(messages);
			case "deepseek-v4":
				return this.callDeepSeekV4(messages);
			case "gemini":
				return this.callGemini(messages);
			case "tavily":
				return this.callTavily(messages);
			case "moonshot-k2.5":
				return this.callMoonshot(messages, "kimi-k2.5");
			case "moonshot-k2.6":
				return this.callMoonshot(messages, "kimi-k2.6");
			case "xiaomi-mimo":
				return this.callXiaomi(messages);
			case "qwen3.5-plus":
				return this.callQwen(messages, "qwen-plus");
			case "qwen3.6-plus":
				return this.callQwen(messages, "qwen-plus");
			case "minimax-m2.5":
				return this.callMiniMax(messages, "MiniMax-M2.5");
			case "minimax-m2.7":
				return this.callMiniMax(messages, "MiniMax-M2.7");
			case "glm-deepinfra":
				return this.callDeepInfra(messages, "THUDM/glm-4-9b-chat");
			case "glm-fireworks":
				return this.callFireworks(messages, "THUDM/glm-4-9b-chat");
			case "glm-zai":
				return this.callZai(messages, "THUDM/glm-4-9b-chat");
			case "groq":
				return this.callGroq(messages);
			case "kiro-ai":
				return this.callKiroAI(messages);
			case "mistral":
				return this.callMistral(messages);
			case "openai":
				return this.callOpenAI(messages);
			case "carnice-9b-local":
				return this.callCarnice(messages);
			case "claude-code-cli":
			case "codex-cli":
			case "gemini-cli":
				return this.callCliDriver(provider, messages);
			default:
				throw new Error(`Unknown provider: ${provider}`);
		}
	}

	/**
	 * Multi-AI orchestration entry point: route to a CLI driver provider
	 * (Gap 2). The driver registry is loaded lazily and cached so the
	 * first call pays the JSON-config read cost once. Errors propagate
	 * (missing binary, non-zero exit, timeout) — the router's existing
	 * cooldown + fallback machinery upgrades them to a provider switch.
	 */
	private cliRegistry: Map<ProviderId, CliDriverConfig> | null = null;
	private async callCliDriver(
		provider: ProviderId,
		messages: LLMMessage[],
	): Promise<LLMResponse> {
		if (!this.cliRegistry) {
			this.cliRegistry = await loadCliDriverRegistry();
		}
		const cfg = this.cliRegistry.get(provider);
		if (!cfg) {
			throw new Error(
				`CLI driver provider "${provider}" not registered. Available: ${[
					...this.cliRegistry.keys(),
				].join(", ")}`,
			);
		}
		return callCliDriver(cfg, messages);
	}

	private async callOpenCode(messages: LLMMessage[]): Promise<LLMResponse> {
		// Simulate 429 rate limit for demo purposes
		if (this.simulateFailure && !this.failureSimulated) {
			this.failureSimulated = true;
			throw new Error("OpenCode Go API Error: 429 Rate Limit Exceeded");
		}

		if (!this.opencodeApiKey) {
			throw new Error(
				"OpenCode API key not configured. Keys must start with 'oc-' or 'opencode-'.",
			);
		}

		// OpenCode uses the Anthropic Messages API format
		const systemMessages = messages.filter((m) => m.role === "system");
		const nonSystemMessages = messages.filter((m) => m.role !== "system");
		const systemPrompt =
			systemMessages.map((m) => m.content).join("\n") || undefined;

		const body: Record<string, unknown> = {
			model: MODEL_NAMES["opencode-go"],
			max_tokens: 8096,
			messages: nonSystemMessages.map((m) => ({
				role: m.role,
				content: m.content,
			})),
		};
		if (systemPrompt) body.system = systemPrompt;

		const response = await fetch(this.API_URLS["opencode-go"], {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": this.opencodeApiKey,
				"anthropic-version": "2023-06-01",
			},
			body: JSON.stringify(this.withReplayDefaults(body)),
			signal: AbortSignal.timeout(30000),
		});

		if (!response.ok) {
			const errorText = await response.text().catch(() => "");
			await this.logEvent(
				"api_call_failed",
				{ provider: "opencode-go", status: response.status, error: errorText },
				"error",
				{ provider: "opencode-go" },
			);
			throw new Error(
				`OpenCode Go API Error: ${response.status} ${response.statusText}`,
			);
		}

		const data = (await response.json()) as {
			content?: Array<{ type: string; text?: string }>;
			usage?: { input_tokens?: number; output_tokens?: number };
		};
		const content = data.content?.find((b) => b.type === "text")?.text || "";
		return {
			content,
			provider: "opencode-go",
			model: MODEL_NAMES["opencode-go"],
			usage: {
				promptTokens: data.usage?.input_tokens || 0,
				completionTokens: data.usage?.output_tokens || 0,
				totalTokens:
					(data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
			},
		};
	}

	private async callAnthropicApi(messages: LLMMessage[]): Promise<LLMResponse> {
		if (!this.anthropicApiKey) {
			throw new Error(
				"Anthropic API key not configured. Keys must start with 'sk-ant-api03-'.",
			);
		}

		// Validate key format - reject OAuth tokens
		if (!this.anthropicApiKey.startsWith("sk-ant-api03-")) {
			const sanitized = this.anthropicApiKey.slice(-4);
			await this.logEvent(
				"api_key_validation_failed",
				{
					provider: "anthropic-api",
					keyLastFour: sanitized,
					reason: "format mismatch: must start with sk-ant-api03-",
				},
				"error",
				{ provider: "anthropic-api" },
			);
			throw new Error(
				"Invalid Anthropic API key format. Keys must start with 'sk-ant-api03-'. OAuth tokens (sk-ant-oat01-*) are not supported.",
			);
		}

		const systemMessages = messages.filter((m) => m.role === "system");
		const nonSystemMessages = messages.filter((m) => m.role !== "system");
		const systemPrompt =
			systemMessages.map((m) => m.content).join("\n") || undefined;

		const body: Record<string, unknown> = {
			model: MODEL_NAMES["anthropic-api"],
			max_tokens: 8096,
			messages: nonSystemMessages.map((m) => ({
				role: m.role,
				content: m.content,
			})),
		};
		if (systemPrompt) body.system = systemPrompt;

		const response = await fetch(this.API_URLS["anthropic-api"], {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": this.anthropicApiKey,
				"anthropic-version": "2023-06-01",
			},
			body: JSON.stringify(this.withReplayDefaults(body)),
			signal: AbortSignal.timeout(60000),
		});

		if (!response.ok) {
			const errorText = await response.text().catch(() => "");
			const sanitized = this.anthropicApiKey.slice(-4);
			await this.logEvent(
				"api_call_failed",
				{
					provider: "anthropic-api",
					status: response.status,
					keyLastFour: sanitized,
					error: errorText,
				},
				"error",
				{ provider: "anthropic-api" },
			);
			throw new Error(
				`Anthropic API Error: ${response.status} ${response.statusText}`,
			);
		}

		const data = (await response.json()) as {
			content?: Array<{ type: string; text?: string }>;
			usage?: { input_tokens?: number; output_tokens?: number };
		};
		const content = data.content?.find((b) => b.type === "text")?.text || "";
		return {
			content,
			provider: "anthropic-api",
			model: MODEL_NAMES["anthropic-api"],
			usage: {
				promptTokens: data.usage?.input_tokens || 0,
				completionTokens: data.usage?.output_tokens || 0,
				totalTokens:
					(data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
			},
		};
	}

	private async callGeminiApi(messages: LLMMessage[]): Promise<LLMResponse> {
		if (!this.geminiApiKeyDirect) {
			throw new Error(
				"Google AI Studio API key not configured. Keys must start with 'AIza'.",
			);
		}

		// Validate key format
		if (!this.geminiApiKeyDirect.startsWith("AIza")) {
			const sanitized = this.geminiApiKeyDirect.slice(-4);
			await this.logEvent(
				"api_key_validation_failed",
				{
					provider: "gemini-api",
					keyLastFour: sanitized,
					reason: "format mismatch: must start with AIza",
				},
				"error",
				{ provider: "gemini-api" },
			);
			throw new Error(
				"Invalid Google AI Studio API key format. Keys must start with 'AIza'.",
			);
		}

		const model = MODEL_NAMES["gemini-api"];
		const url = `${this.API_URLS["gemini-api"]}/${model}:generateContent?key=${this.geminiApiKeyDirect}`;

		const response = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-goog-api-key": this.geminiApiKeyDirect,
			},
			body: JSON.stringify({
				contents: messages.map((msg) => ({
					role: msg.role === "assistant" ? "model" : "user",
					parts: [{ text: msg.content }],
				})),
			}),
			signal: AbortSignal.timeout(30000),
		});

		if (!response.ok) {
			const errorText = await response.text().catch(() => "");
			const sanitized = this.geminiApiKeyDirect.slice(-4);
			await this.logEvent(
				"api_call_failed",
				{
					provider: "gemini-api",
					status: response.status,
					keyLastFour: sanitized,
					error: errorText,
				},
				"error",
				{ provider: "gemini-api" },
			);
			throw new Error(
				`Google AI Studio API Error: ${response.status} ${response.statusText}`,
			);
		}

		const data = (await response.json()) as {
			candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
			usageMetadata?: {
				promptTokenCount?: number;
				candidatesTokenCount?: number;
				totalTokenCount?: number;
			};
		};
		const content = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
		return {
			content,
			provider: "gemini-api",
			model,
			usage: {
				promptTokens: data.usageMetadata?.promptTokenCount || 0,
				completionTokens: data.usageMetadata?.candidatesTokenCount || 0,
				totalTokens: data.usageMetadata?.totalTokenCount || 0,
			},
		};
	}

	private async callZai(
		messages: LLMMessage[],
		model: string,
	): Promise<LLMResponse> {
		if (!this.zaiApiKey) {
			throw new Error("Z.ai API key not configured");
		}

		const response = await fetch(
			"https://api.siliconflow.cn/v1/chat/completions",
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.zaiApiKey}`,
				},
				body: JSON.stringify({ model, messages }),
				signal: AbortSignal.timeout(30000),
			},
		);

		if (!response.ok) {
			throw new Error(
				`Z.ai API Error: ${response.status} ${response.statusText}`,
			);
		}

		const data = (await response.json()) as {
			choices?: Array<{ message?: { content?: string } }>;
			usage?: {
				prompt_tokens?: number;
				completion_tokens?: number;
				total_tokens?: number;
			};
		};
		return {
			content: data.choices?.[0]?.message?.content || "",
			provider: "glm-zai",
			model,
			usage: {
				promptTokens: data.usage?.prompt_tokens || 0,
				completionTokens: data.usage?.completion_tokens || 0,
				totalTokens: data.usage?.total_tokens || 0,
			},
		};
	}

	private async callDeepSeek(messages: LLMMessage[]): Promise<LLMResponse> {
		const response = await fetch(this.API_URLS.deepseek, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.deepseekApiKey}`,
			},
			body: JSON.stringify(
				this.withReplayDefaults({
					model: "deepseek-coder",
					messages,
				}),
			),
			signal: AbortSignal.timeout(30000), // 30 second timeout
		});

		if (!response.ok) {
			throw new Error(
				`DeepSeek API Error: ${response.status} ${response.statusText}`,
			);
		}

		const data = await response.json();
		return {
			content: data.choices?.[0]?.message?.content || "",
			provider: "deepseek",
			model: "deepseek-coder",
			usage: {
				promptTokens: data.usage?.prompt_tokens || 0,
				completionTokens: data.usage?.completion_tokens || 0,
				totalTokens: data.usage?.total_tokens || 0,
			},
		};
	}

	private async callGemini(messages: LLMMessage[]): Promise<LLMResponse> {
		const response = await fetch(
			`${this.API_URLS.gemini}?key=${this.geminiApiKey}`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					contents: messages.map((msg) => ({
						role: msg.role === "assistant" ? "model" : msg.role,
						parts: [{ text: msg.content }],
					})),
				}),
				signal: AbortSignal.timeout(30000), // 30 second timeout
			},
		);

		if (!response.ok) {
			throw new Error(
				`Gemini API Error: ${response.status} ${response.statusText}`,
			);
		}

		const data = await response.json();
		const content = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
		return {
			content,
			provider: "gemini",
			model: "gemini-2.0-flash",
			usage: {
				promptTokens: data.usageMetadata?.promptTokenCount || 0,
				completionTokens: data.usageMetadata?.candidatesTokenCount || 0,
				totalTokens: data.usageMetadata?.totalTokenCount || 0,
			},
		};
	}

	/**
	 * Tavily Search - Real-time web search for AI agents
	 * Takes first user message as search query
	 */
	private async callTavily(messages: LLMMessage[]): Promise<LLMResponse> {
		if (!this.tavilyApiKey) {
			throw new Error(
				"Tavily API key not configured. Get one at https://app.tavily.com/",
			);
		}

		// Extract query from user message
		const userMessage = messages.find((m) => m.role === "user");
		const query = userMessage?.content || messages[0]?.content || "";

		if (!query) {
			throw new Error("Tavily search requires a query");
		}

		const response = await fetch(this.API_URLS.tavily, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.tavilyApiKey}`,
			},
			body: JSON.stringify({
				query,
				max_results: 10,
				include_answer: true,
				include_raw_content: false,
				include_images: false,
			}),
			signal: AbortSignal.timeout(30000),
		});

		if (!response.ok) {
			throw new Error(
				`Tavily API Error: ${response.status} ${response.statusText}`,
			);
		}

		const data = await response.json();

		// Format results for LLM consumption
		const results = data.results || [];
		const answer = data.answer || "";

		// Format as structured content
		let content = "";
		if (answer) {
			content = `Summary: ${answer}\n\n`;
		}
		content += "Search Results:\n";
		results.forEach((result: any, index: number) => {
			content += `${index + 1}. ${result.title}: ${result.content}\nURL: ${result.url}\n\n`;
		});

		return {
			content,
			provider: "tavily",
			model: "tavily-search",
			usage: {
				promptTokens: query.length,
				completionTokens: content.length,
				totalTokens: query.length + content.length,
			},
		};
	}

	private async callDeepSeekV4(messages: LLMMessage[]): Promise<LLMResponse> {
		const response = await fetch(this.API_URLS["deepseek-v4"], {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.deepseekApiKey}`,
			},
			body: JSON.stringify({
				model: "deepseek-chat",
				messages,
			}),
			signal: AbortSignal.timeout(30000),
		});

		if (!response.ok) {
			throw new Error(
				`DeepSeek V4 API Error: ${response.status} ${response.statusText}`,
			);
		}

		const data = await response.json();
		return {
			content: data.choices?.[0]?.message?.content || "",
			provider: "deepseek-v4",
			model: "deepseek-chat",
			usage: {
				promptTokens: data.usage?.prompt_tokens || 0,
				completionTokens: data.usage?.completion_tokens || 0,
				totalTokens: data.usage?.total_tokens || 0,
			},
		};
	}

	private async callMoonshot(
		messages: LLMMessage[],
		model: string,
	): Promise<LLMResponse> {
		if (!this.moonshotApiKey) {
			throw new Error("Moonshot API key not configured");
		}

		const response = await fetch(this.API_URLS["moonshot-k2.5"], {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.moonshotApiKey}`,
			},
			body: JSON.stringify({
				model,
				messages,
			}),
			signal: AbortSignal.timeout(30000),
		});

		if (!response.ok) {
			throw new Error(
				`Moonshot (Kimi) API Error: ${response.status} ${response.statusText}`,
			);
		}

		const data = await response.json();
		return {
			content: data.choices?.[0]?.message?.content || "",
			provider: "moonshot-k2.6",
			model,
			usage: {
				promptTokens: data.usage?.prompt_tokens || 0,
				completionTokens: data.usage?.completion_tokens || 0,
				totalTokens: data.usage?.total_tokens || 0,
			},
		};
	}

	private async callXiaomi(messages: LLMMessage[]): Promise<LLMResponse> {
		if (!this.xiaomiApiKey) {
			throw new Error("Xiaomi API key not configured");
		}

		const response = await fetch(this.API_URLS["xiaomi-mimo"], {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.xiaomiApiKey}`,
			},
			body: JSON.stringify({
				model: "MiMo-V2-8B",
				messages,
			}),
			signal: AbortSignal.timeout(30000),
		});

		if (!response.ok) {
			throw new Error(
				`Xiaomi MiMo API Error: ${response.status} ${response.statusText}`,
			);
		}

		const data = await response.json();
		return {
			content: data.choices?.[0]?.message?.content || "",
			provider: "xiaomi-mimo",
			model: "MiMo-V2-8B",
			usage: {
				promptTokens: data.usage?.prompt_tokens || 0,
				completionTokens: data.usage?.completion_tokens || 0,
				totalTokens: data.usage?.total_tokens || 0,
			},
		};
	}

	private async callQwen(
		messages: LLMMessage[],
		model: string,
	): Promise<LLMResponse> {
		if (!this.alibabaApiKey) {
			throw new Error("Alibaba API key not configured");
		}

		const response = await fetch(this.API_URLS["qwen3.6-plus"], {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.alibabaApiKey}`,
			},
			body: JSON.stringify({
				model,
				input: { messages },
			}),
			signal: AbortSignal.timeout(30000),
		});

		if (!response.ok) {
			throw new Error(
				`Qwen (Alibaba) API Error: ${response.status} ${response.statusText}`,
			);
		}

		const data = await response.json();
		return {
			content:
				data.output?.choices?.[0]?.message?.content || data.output?.text || "",
			provider: "qwen3.6-plus",
			model,
			usage: {
				promptTokens: data.usage?.prompt_tokens || 0,
				completionTokens: data.usage?.completion_tokens || 0,
				totalTokens: data.usage?.total_tokens || 0,
			},
		};
	}

	private async callMiniMax(
		messages: LLMMessage[],
		model: string,
	): Promise<LLMResponse> {
		if (!this.minimaxApiKey) {
			throw new Error("MiniMax API key not configured");
		}

		const response = await fetch(this.API_URLS["minimax-m2.7"], {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.minimaxApiKey}`,
			},
			body: JSON.stringify({
				model,
				messages,
			}),
			signal: AbortSignal.timeout(30000),
		});

		if (!response.ok) {
			throw new Error(
				`MiniMax API Error: ${response.status} ${response.statusText}`,
			);
		}

		const data = await response.json();
		return {
			content: data.choices?.[0]?.message?.content || "",
			provider: "minimax-m2.7",
			model,
			usage: {
				promptTokens: data.usage?.prompt_tokens || 0,
				completionTokens: data.usage?.completion_tokens || 0,
				totalTokens: data.usage?.total_tokens || 0,
			},
		};
	}

	private async callDeepInfra(
		messages: LLMMessage[],
		model: string,
	): Promise<LLMResponse> {
		if (!this.deepinfraApiKey) {
			throw new Error("DeepInfra API key not configured");
		}

		const response = await fetch(this.API_URLS["glm-deepinfra"], {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.deepinfraApiKey}`,
			},
			body: JSON.stringify({
				model,
				messages,
			}),
			signal: AbortSignal.timeout(30000),
		});

		if (!response.ok) {
			throw new Error(
				`DeepInfra API Error: ${response.status} ${response.statusText}`,
			);
		}

		const data = await response.json();
		return {
			content: data.choices?.[0]?.message?.content || "",
			provider: "glm-deepinfra",
			model,
			usage: {
				promptTokens: data.usage?.prompt_tokens || 0,
				completionTokens: data.usage?.completion_tokens || 0,
				totalTokens: data.usage?.total_tokens || 0,
			},
		};
	}

	private async callFireworks(
		messages: LLMMessage[],
		model: string,
	): Promise<LLMResponse> {
		if (!this.fireworksApiKey) {
			throw new Error("Fireworks API key not configured");
		}

		const response = await fetch(this.API_URLS["glm-fireworks"], {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.fireworksApiKey}`,
			},
			body: JSON.stringify({
				model,
				messages,
			}),
			signal: AbortSignal.timeout(30000),
		});

		if (!response.ok) {
			throw new Error(
				`Fireworks AI API Error: ${response.status} ${response.statusText}`,
			);
		}

		const data = await response.json();
		return {
			content: data.choices?.[0]?.message?.content || "",
			provider: "glm-fireworks",
			model,
			usage: {
				promptTokens: data.usage?.prompt_tokens || 0,
				completionTokens: data.usage?.completion_tokens || 0,
				totalTokens: data.usage?.total_tokens || 0,
			},
		};
	}

	private async callGroq(messages: LLMMessage[]): Promise<LLMResponse> {
		if (!this.groqApiKey) {
			throw new Error(
				"Groq API key not configured. Get one at https://console.groq.com/keys",
			);
		}

		const response = await fetch(this.API_URLS.groq, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.groqApiKey}`,
			},
			body: JSON.stringify({
				model: "llama-3.3-70b-versatile",
				messages,
			}),
			signal: AbortSignal.timeout(30000),
		});

		if (!response.ok) {
			const errorText = await response.text().catch(() => "");
			throw new Error(
				`Groq API Error: ${response.status} ${response.statusText} ${errorText}`,
			);
		}

		const data = await response.json();
		return {
			content: data.choices?.[0]?.message?.content || "",
			provider: "groq",
			model: "llama-4-maverick-17b-128e-instruct",
			usage: {
				promptTokens: data.usage?.prompt_tokens || 0,
				completionTokens: data.usage?.completion_tokens || 0,
				totalTokens: data.usage?.total_tokens || 0,
			},
		};
	}

	private async callKiroAI(messages: LLMMessage[]): Promise<LLMResponse> {
		const response = await fetch(this.API_URLS["kiro-ai"], {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				// Kiro AI does not require authentication
			},
			body: JSON.stringify({
				model: MODEL_NAMES["kiro-ai"],
				messages,
			}),
			signal: AbortSignal.timeout(30000),
		});

		if (!response.ok) {
			const errorText = await response.text().catch(() => "");
			throw new Error(
				`Kiro AI API Error: ${response.status} ${response.statusText} ${errorText}`,
			);
		}

		const data = await response.json();
		return {
			content: data.choices?.[0]?.message?.content || "",
			provider: "kiro-ai",
			model: MODEL_NAMES["kiro-ai"],
			usage: {
				promptTokens: data.usage?.prompt_tokens || 0,
				completionTokens: data.usage?.completion_tokens || 0,
				totalTokens: data.usage?.total_tokens || 0,
			},
		};
	}

	private async callMistral(messages: LLMMessage[]): Promise<LLMResponse> {
		if (!this.mistralApiKey) {
			throw new Error(
				"Mistral API key not configured. Get one at https://console.mistral.ai/",
			);
		}

		const response = await fetch(this.API_URLS.mistral, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.mistralApiKey}`,
			},
			body: JSON.stringify({
				model: MODEL_NAMES.mistral,
				messages,
			}),
			signal: AbortSignal.timeout(30000),
		});

		if (!response.ok) {
			const errorText = await response.text().catch(() => "");
			throw new Error(
				`Mistral API Error: ${response.status} ${response.statusText} ${errorText}`,
			);
		}

		const data = await response.json();
		return {
			content: data.choices?.[0]?.message?.content || "",
			provider: "mistral",
			model: MODEL_NAMES.mistral,
			usage: {
				promptTokens: data.usage?.prompt_tokens || 0,
				completionTokens: data.usage?.completion_tokens || 0,
				totalTokens: data.usage?.total_tokens || 0,
			},
		};
	}

	private async callOpenAI(messages: LLMMessage[]): Promise<LLMResponse> {
		if (!this.openaiApiKey) {
			throw new Error(
				"OpenAI API key not configured. Get one at https://platform.openai.com/",
			);
		}

		const response = await fetch(this.API_URLS.openai, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.openaiApiKey}`,
			},
			body: JSON.stringify(
				this.withReplayDefaults({
					model: MODEL_NAMES.openai,
					messages,
				}),
			),
			signal: AbortSignal.timeout(30000),
		});

		if (!response.ok) {
			const errorText = await response.text().catch(() => "");
			throw new Error(
				`OpenAI API Error: ${response.status} ${response.statusText} ${errorText}`,
			);
		}

		const data = await response.json();
		return {
			content: data.choices?.[0]?.message?.content || "",
			provider: "openai",
			model: MODEL_NAMES.openai,
			usage: {
				promptTokens: data.usage?.prompt_tokens || 0,
				completionTokens: data.usage?.completion_tokens || 0,
				totalTokens: data.usage?.total_tokens || 0,
			},
		};
	}

	private async callCarnice(messages: LLMMessage[]): Promise<LLMResponse> {
		const startedAt = Date.now();
		const response = await fetch(this.API_URLS["carnice-9b-local"], {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(
				this.withReplayDefaults({
					model: MODEL_NAMES["carnice-9b-local"],
					messages,
				}),
			),
			// Local GGUF Q4 inference on consumer GPU: ~1s for short replies,
			// up to 30s for multi-paragraph. 60s ceiling covers both.
			signal: AbortSignal.timeout(60000),
		}).catch((err) => {
			throw new Error(
				`Carnice local server unreachable at ${this.API_URLS["carnice-9b-local"]} — is llama-cpp-python running? Original: ${(err as Error).message}`,
			);
		});

		if (!response.ok) {
			const errorText = await response.text().catch(() => "");
			throw new Error(
				`Carnice local server error: ${response.status} ${response.statusText} ${errorText}`,
			);
		}

		const data = await response.json();
		const totalTokens = data.usage?.total_tokens || 0;
		// Emit a contextforge_savings event so the ledger reflects the cost-zero local path.
		// Baseline is informational — uses groq llama-3.3-70b output pricing as cheap-cloud reference.
		await this.logEvent(
			"contextforge_savings",
			{
				provider: "carnice-9b-local",
				model: MODEL_NAMES["carnice-9b-local"],
				tokens: totalTokens,
				latencyMs: Date.now() - startedAt,
				costUsdLocal: 0,
				costUsdBaselineEstimate: (totalTokens / 1_000_000) * 0.59,
			},
			"info",
		);

		return {
			content: data.choices?.[0]?.message?.content || "",
			provider: "carnice-9b-local",
			model: MODEL_NAMES["carnice-9b-local"],
			usage: {
				promptTokens: data.usage?.prompt_tokens || 0,
				completionTokens: data.usage?.completion_tokens || 0,
				totalTokens,
			},
		};
	}
}
