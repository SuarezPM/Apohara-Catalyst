// Role types for task routing (role: research, planning, execution, verification)
export type TaskRole = "research" | "planning" | "execution" | "verification";

// All supported LLM providers and models
// Based on user's model list: GLM-5.1, GLM-5, Kimi K2.5, K2.6, MiMo-V2 series, Qwen3.5/3.6 Plus, MiniMax M2.5/M2.7, DeepSeek V4
export type ProviderId =
	| "opencode-go" // OpenCode Go - Anthropic Messages API at api.opencode.ai
	| "anthropic-api" // Anthropic direct API - sk-ant-api03-* keys
	| "gemini-api" // Google AI Studio - x-goog-api-key header
	| "deepseek-v4" // DeepSeek V4 Pro/Flash - Reasoning & coding
	| "deepseek" // DeepSeek Coder (fallback)
	| "tavily" // Tavily - Web search for AI agents
	| "gemini" // Gemini 2.0 - Planning (generateContent format)
	| "moonshot-k2.5" // Kimi K2.5 (Moonshot)
	| "moonshot-k2.6" // Kimi K2.6 (Moonshot) - Latest & most powerful
	| "xiaomi-mimo" // Xiaomi MiMo V2 series
	| "qwen3.5-plus" // Qwen 3.5 Plus (Alibaba)
	| "qwen3.6-plus" // Qwen 3.6 Plus (Alibaba) - Latest
	| "minimax-m2.5" // MiniMax M2.5
	| "minimax-m2.7" // MiniMax M2.7 - Latest from MiniMax
	| "glm-deepinfra" // GLM via DeepInfra
	| "glm-fireworks" // GLM via Fireworks AI
	| "glm-zai" // GLM via Z.ai
	| "groq" // Groq - Ultra-fast inference (Llama, Qwen, etc.)
	| "kiro-ai" // Kiro AI - Free tier, no auth required
	| "mistral" // Mistral AI - Free tier (mistral-small-latest)
	| "openai" // OpenAI - gpt-4o-mini
	| "carnice-9b-local" // Carnice-9b (Qwen3.5-9B Hermes fine-tune) served locally via llama-cpp-python on GPU; M015 local-first path
	| "claude-code-cli" // Driver: subprocess of @anthropic-ai/claude-code (`claude --print`) — uses the user's Claude subscription
	| "codex-cli" // Driver: subprocess of @openai/codex (`codex exec`) — uses the user's ChatGPT/Codex subscription
	| "gemini-cli"; // Driver: subprocess of @google/gemini-cli (`gemini -p`) — uses the user's Google account

// Model capabilities for intelligent routing
export interface ModelCapability {
	id: ProviderId;
	name: string;
	provider: string; // Company name
	bestFor: TaskRole[]; // Primary roles this model excels at
	strengths: string[];
	contextWindow: number; // Max tokens
	supportsVision: boolean;
}

// All available models with their capabilities
export const MODELS: ModelCapability[] = [
	// DeepSeek V4 - Most powerful for reasoning and coding
	{
		id: "deepseek-v4",
		name: "DeepSeek V4 Pro",
		provider: "DeepSeek",
		bestFor: ["execution", "verification"],
		strengths: ["code generation", "reasoning", "debugging", "low latency"],
		contextWindow: 128000,
		supportsVision: false,
	},
	// Kimi K2.6 - Latest and very powerful
	{
		id: "moonshot-k2.6",
		name: "Kimi K2.6",
		provider: "Moonshot AI",
		bestFor: ["execution", "planning"],
		strengths: ["long context", "code generation", "reasoning"],
		contextWindow: 200000,
		supportsVision: true,
	},
	{
		id: "moonshot-k2.5",
		name: "Kimi K2.5",
		provider: "Moonshot AI",
		bestFor: ["execution", "planning"],
		strengths: ["code generation", "reasoning"],
		contextWindow: 128000,
		supportsVision: true,
	},
	// Qwen 3.6 Plus - Latest from Alibaba
	{
		id: "qwen3.6-plus",
		name: "Qwen 3.6 Plus",
		provider: "Alibaba Cloud",
		bestFor: ["planning", "execution"],
		strengths: ["code generation", "multilingual", "reasoning"],
		contextWindow: 131072,
		supportsVision: true,
	},
	{
		id: "qwen3.5-plus",
		name: "Qwen 3.5 Plus",
		provider: "Alibaba Cloud",
		bestFor: ["planning", "execution"],
		strengths: ["code generation", "cost-effective"],
		contextWindow: 32768,
		supportsVision: false,
	},
	// MiniMax M2.7 - Latest
	{
		id: "minimax-m2.7",
		name: "MiniMax M2.7",
		provider: "MiniMax",
		bestFor: ["execution", "planning"],
		strengths: ["code generation", "reasoning"],
		contextWindow: 100000,
		supportsVision: false,
	},
	{
		id: "minimax-m2.5",
		name: "MiniMax M2.5",
		provider: "MiniMax",
		bestFor: ["execution"],
		strengths: ["code generation"],
		contextWindow: 100000,
		supportsVision: false,
	},
	// Xiaomi MiMo
	{
		id: "xiaomi-mimo",
		name: "Xiaomi MiMo V2",
		provider: "Xiaomi",
		bestFor: ["execution"],
		strengths: ["code generation", "efficient"],
		contextWindow: 32768,
		supportsVision: false,
	},
	// GLM models via different providers
	{
		id: "glm-deepinfra",
		name: "GLM-5 via DeepInfra",
		provider: "DeepInfra",
		bestFor: ["planning"],
		strengths: ["multilingual", "fast"],
		contextWindow: 128000,
		supportsVision: true,
	},
	{
		id: "glm-fireworks",
		name: "GLM-5 via Fireworks",
		provider: "Fireworks AI",
		bestFor: ["planning"],
		strengths: ["multilingual", "fast"],
		contextWindow: 128000,
		supportsVision: true,
	},
	{
		id: "glm-zai",
		name: "GLM-5 via Z.ai",
		provider: "Z.ai",
		bestFor: ["planning"],
		strengths: ["multilingual", "fast"],
		contextWindow: 128000,
		supportsVision: true,
	},
	// Groq - Ultra-fast inference for planning and execution
	{
		id: "groq",
		name: "Groq (Llama 4 Maverick / Qwen 3)",
		provider: "Groq",
		bestFor: ["planning", "execution"],
		strengths: [
			"ultra-low latency",
			"high throughput",
			"cost-effective",
			"openai-compatible",
		],
		contextWindow: 131072,
		supportsVision: false,
	},
	// Kiro AI - Free tier, no auth required
	{
		id: "kiro-ai",
		name: "Kiro AI (Claude Sonnet / DeepSeek / Qwen)",
		provider: "Kiro AI",
		bestFor: ["planning", "execution", "verification"],
		strengths: [
			"free tier",
			"no auth required",
			"multiple models",
			"openai-compatible",
		],
		contextWindow: 200000,
		supportsVision: false,
	},
	// Mistral - Free tier
	{
		id: "mistral",
		name: "Mistral Small Latest",
		provider: "Mistral AI",
		bestFor: ["execution", "planning"],
		strengths: ["free tier available", "european", "openai-compatible"],
		contextWindow: 32000,
		supportsVision: false,
	},
	// OpenAI - Cost-effective mini model
	{
		id: "openai",
		name: "OpenAI GPT-4o Mini",
		provider: "OpenAI",
		bestFor: ["execution", "verification"],
		strengths: ["reliable", "cost-effective", "fast"],
		contextWindow: 128000,
		supportsVision: false,
	},
	// Tavily - Real-time web search for AI agents (replaces Perplexity)
	{
		id: "tavily",
		name: "Tavily Search API",
		provider: "Tavily",
		bestFor: ["research"],
		strengths: [
			"real-time web search",
			"web extraction",
			"research",
			"up-to-date info",
			"AI-optimized",
		],
		contextWindow: 10000, // Optimizado para resultados de búsqueda
		supportsVision: false,
	},
	// Paid API providers with Anthropic Messages API format
	{
		id: "anthropic-api",
		name: "Anthropic Claude",
		provider: "Anthropic",
		bestFor: ["execution", "planning", "verification"],
		strengths: ["code generation", "reasoning", "long context"],
		contextWindow: 200000,
		supportsVision: true,
	},
	{
		id: "gemini-api",
		name: "Google AI Studio",
		provider: "Google",
		bestFor: ["execution", "planning", "research"],
		strengths: ["long context", "multimodal", "fast"],
		contextWindow: 1000000,
		supportsVision: true,
	},
	// Legacy providers
	{
		id: "opencode-go",
		name: "OpenCode Go",
		provider: "OpenCode",
		bestFor: ["execution"],
		strengths: ["code generation", "Anthropic Messages API compatible"],
		contextWindow: 128000,
		supportsVision: true,
	},
	{
		id: "deepseek",
		name: "DeepSeek Coder",
		provider: "DeepSeek",
		bestFor: ["verification", "execution"],
		strengths: ["code generation", "debugging"],
		contextWindow: 16384,
		supportsVision: false,
	},
	{
		id: "gemini",
		name: "Gemini 2.0 Flash",
		provider: "Google",
		bestFor: ["planning", "research"],
		strengths: ["fast", "multimodal", "grounding"],
		contextWindow: 1000000,
		supportsVision: true,
	},
	// Carnice-9b — local GPU model (M015 local-first path).
	// Fine-tune of Qwen3.5-9B optimized for agent behavior (Hermes harness, tool calling).
	// Served via llama-cpp-python on user GPU (RTX 2060S 8GB w/ Q4_K_M).
	{
		id: "carnice-9b-local",
		name: "Carnice-9b (local Hermes/Qwen3.5)",
		provider: "Local GPU (llama.cpp)",
		bestFor: ["execution", "verification"],
		strengths: [
			"local inference",
			"zero cost",
			"tool calling (Hermes format)",
			"private",
			"offline-capable",
		],
		contextWindow: 4096, // Server-side n_ctx limit; can be raised to 262144 model max
		supportsVision: false,
	},
	// CLI-driver providers (Gap 2 / M013.3 partial). Each rides the
	// user's existing subscription via the official agent CLI on PATH.
	// We declare them with the underlying model family's known
	// strengths so capability-based selection picks the right CLI per
	// role.
	{
		id: "claude-code-cli",
		name: "Claude Code CLI (Anthropic subscription)",
		provider: "Anthropic (via @anthropic-ai/claude-code)",
		bestFor: ["planning", "execution", "verification"],
		strengths: [
			"code generation",
			"long context",
			"tool use",
			"subscription-based (no API key)",
		],
		contextWindow: 200000,
		supportsVision: true,
	},
	{
		id: "codex-cli",
		name: "Codex CLI (OpenAI subscription)",
		provider: "OpenAI (via @openai/codex)",
		bestFor: ["execution", "planning"],
		strengths: [
			"code generation",
			"fast iteration",
			"subscription-based (no API key)",
		],
		contextWindow: 128000,
		supportsVision: true,
	},
	{
		id: "gemini-cli",
		name: "Gemini CLI (Google subscription)",
		provider: "Google (via @google/gemini-cli)",
		bestFor: ["verification", "research", "planning"],
		strengths: [
			"verification / audit",
			"web search integration",
			"multimodal",
			"subscription-based (no API key)",
		],
		contextWindow: 1000000,
		supportsVision: true,
	},
];

// Get model capability by ID
export function getModelById(id: ProviderId): ModelCapability | undefined {
	return MODELS.find((m) => m.id === id);
}

// Get best models for a specific role (sorted by capability)
export function getBestModelsForRole(role: TaskRole): ModelCapability[] {
	return MODELS.filter((m) => m.bestFor.includes(role)).sort(
		(a, b) => b.contextWindow - a.contextWindow,
	);
}

// Role-to-provider mapping with intelligent selection
// CLI-driver primary (M013.3 partial): claude-code-cli rides the user's
// existing Claude Code subscription — no API key needed, no TOS-grey
// scraping. Falls through to API-keyed providers if `claude` isn't
// installed or returns an error.
export const ROLE_TO_PROVIDER: Record<TaskRole, ProviderId> = {
	research: "tavily", // Tavily for real-time web search/research (CLI drivers can't web-search)
	planning: "claude-code-cli", // Subscription-based, fast, no key required
	execution: "claude-code-cli", // Same — coder role
	verification: "gemini-cli", // Cross-vendor by design: a different AI audits the diff
};

// Fallback provider order for each role.
// INVARIANT: fallback[0] === ROLE_TO_PROVIDER[role] (primary leads the chain).
// Verified in tests/e2e-swarm-integration.test.ts "should have fallback provider chains".
export const ROLE_FALLBACK_ORDER: Record<TaskRole, ProviderId[]> = {
	research: [
		"tavily",
		"gemini-cli",
		"claude-code-cli",
		"gemini",
		"gemini-api",
		"anthropic-api",
		"moonshot-k2.6",
		"groq",
		"qwen3.6-plus",
	],
	planning: [
		"claude-code-cli",
		"codex-cli",
		"gemini-cli",
		"opencode-go",
		"groq",
		"anthropic-api",
		"gemini-api",
		"moonshot-k2.6",
		"qwen3.6-plus",
		"moonshot-k2.5",
		"qwen3.5-plus",
		"kiro-ai",
		"deepseek",
		"mistral",
	],
	execution: [
		"claude-code-cli",
		"codex-cli",
		"gemini-cli",
		"opencode-go",
		"groq",
		"anthropic-api",
		"deepseek-v4",
		"moonshot-k2.6",
		"minimax-m2.7",
		"qwen3.6-plus",
		"kiro-ai",
		"deepseek",
		"mistral",
		"openai",
		"carnice-9b-local", // Local GPU fallback — zero cost, offline-capable, last resort if cloud chain exhausted
	],
	verification: [
		"gemini-cli", // Cross-vendor audit by design — different AI than the coder
		"codex-cli",
		"claude-code-cli",
		"opencode-go",
		"groq",
		"anthropic-api",
		"gemini-api",
		"deepseek-v4",
		"moonshot-k2.6",
		"kiro-ai",
		"deepseek",
		"openai",
		"carnice-9b-local",
	],
};

export interface Task {
	id: string;
	role?: TaskRole;
	description: string;
	status: "pending" | "in_progress" | "completed" | "failed";
	createdAt: Date;
	updatedAt: Date;
}

export type EventSeverity = "info" | "warning" | "error";

// M018.D — Pattern D: auth-aware fallback error classification.
// Each class drives a different cooldown + retry strategy in ProviderRouter.
export type ProviderErrorClass =
	| "AUTH_FAILURE" // 401/403 — credentials stale; long cooldown + flag for refresh
	| "RATE_LIMIT" // 429 — backoff per Retry-After header
	| "NETWORK" // ECONNREFUSED / timeout / fetch failures — short cooldown, fast retry
	| "MODEL_ERROR"; // 5xx / malformed JSON — short cooldown, ledger warning

export interface EventLog {
	id: string;
	timestamp: string; // ISO string
	type: string;
	severity: EventSeverity;
	taskId?: string;
	payload: Record<string, unknown>;
	// Hash chain fields. Set by EventLedger.log(); absent on legacy (pre-Phase-4) entries.
	prev_hash?: string;
	hash?: string;
	metadata?: {
		provider?: ProviderId;
		model?: string;
		modelName?: string; // Full model name (e.g., "DeepSeek V4 Pro")
		modelProvider?: string; // Company (e.g., "DeepSeek")
		contextWindow?: number; // Max context tokens
		tokens?: { prompt: number; completion: number; total: number };
		costUsd?: number;
		durationMs?: number;
		role?: TaskRole;
		fromProvider?: ProviderId;
		toProvider?: ProviderId;
		errorReason?: string;
		errorClass?: ProviderErrorClass; // M018.D — Pattern D: which class triggered fallback
		fallbackProviders?: ProviderId[]; // List of fallback providers attempted
		capabilityScore?: number; // Score from getCapabilityScore(provider, taskType)
	};
}

export interface OrchestratorState {
	currentTaskId: string | null;
	tasks: Task[];
	status: "idle" | "running" | "paused" | "error";
	lastError?: string;
	// Provider cooldown tracking for state persistence
	failedProviderTimestamps?: Record<string, number>; // providerId -> timestamp of last failure
}
