import { z } from "zod";
import { resolveCredentialSync } from "./credentials.js";

const envSchema = z.object({
	// Primary execution provider (OpenCode Go)
	OPENCODE_API_KEY: z.string().optional(),

	// Paid API providers
	ANTHROPIC_API_KEY: z.string().optional(),
	GOOGLE_AI_STUDIO_API_KEY: z.string().optional(),

	// Core providers
	DEEPSEEK_API_KEY: z.string().optional(),
	PERPLEXITY_API_KEY: z.string().optional(),
	GEMINI_API_KEY: z.string().optional(),

	// Extended providers from user's model list
	MOONSHOT_API_KEY: z.string().optional(), // Kimi K2.5, K2.6
	XIAOMI_API_KEY: z.string().optional(), // MiMo V2 series
	ALIBABA_API_KEY: z.string().optional(), // Qwen 3.5 Plus, 3.6 Plus
	MINIMAX_API_KEY: z.string().optional(), // MiniMax M2.5, M2.7
	DEEPINFRA_API_KEY: z.string().optional(), // GLM-5, GLM-5.1
	FIREWORKS_API_KEY: z.string().optional(), // GLM via Fireworks
	ZAI_API_KEY: z.string().optional(), // Z.ai GLM

	// Tavily - Real-time web search for AI agents
	TAVILY_API_KEY: z.string().optional(),

	// MCP Servers
	GITNEXUS_PATH: z.string().optional(),
	COCOINDEX_CODE_PATH: z.string().optional(),

	// Mem0 - Persistent memory
	MEM0_API_KEY: z.string().optional(),

	// Inngest - Durable workflows
	INNGEST_API_KEY: z.string().optional(),
	INNGEST_APP_ID: z.string().optional(),

	// GitHub integration
	GITHUB_TOKEN: z.string().optional(),
	NODE_ENV: z
		.enum(["development", "production", "test"])
		.default("development"),
});

const parseEnv = () => {
	const result = envSchema.safeParse(process.env);

	if (!result.success) {
		// In test mode, allow missing API keys (tests can inject their own)
		if (process.env.NODE_ENV === "test") {
			return {
				OPENCODE_API_KEY: process.env.OPENCODE_API_KEY || "test-opencode-key",
				ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || undefined,
				GOOGLE_AI_STUDIO_API_KEY:
					process.env.GOOGLE_AI_STUDIO_API_KEY || undefined,
				DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || "test-deepseek-key",
				PERPLEXITY_API_KEY:
					process.env.PERPLEXITY_API_KEY || "test-perplexity-key",
				GEMINI_API_KEY: process.env.GEMINI_API_KEY || "test-gemini-key",
				MOONSHOT_API_KEY: process.env.MOONSHOT_API_KEY || "test-moonshot-key",
				XIAOMI_API_KEY: process.env.XIAOMI_API_KEY || "test-xiaomi-key",
				ALIBABA_API_KEY: process.env.ALIBABA_API_KEY || "test-alibaba-key",
				MINIMAX_API_KEY: process.env.MINIMAX_API_KEY || "test-minimax-key",
				DEEPINFRA_API_KEY:
					process.env.DEEPINFRA_API_KEY || "test-deepinfra-key",
				FIREWORKS_API_KEY:
					process.env.FIREWORKS_API_KEY || "test-fireworks-key",
				ZAI_API_KEY: process.env.ZAI_API_KEY || "test-tavily-key",
				TAVILY_API_KEY: process.env.TAVILY_API_KEY || "test-tavily-key",
				GITNEXUS_PATH: process.env.GITNEXUS_PATH || "",
				COCOINDEX_CODE_PATH: process.env.COCOINDEX_CODE_PATH || "",
				MEM0_API_KEY: process.env.MEM0_API_KEY || "",
				INNGEST_API_KEY: process.env.INNGEST_API_KEY || "",
				INNGEST_APP_ID: process.env.INNGEST_APP_ID || "",
				GITHUB_TOKEN: process.env.GITHUB_TOKEN || undefined,
				NODE_ENV: "test" as const,
			};
		}

		console.error("❌ Invalid environment variables:", result.error.format());
		throw new Error("Invalid environment variables");
	}

	return result.data;
};

export const config = parseEnv();

/**
 * Gets the resolved API key for a provider, checking credentials file first.
 */
export function getProviderKey(provider: string): string | null {
	// Map provider IDs to their canonical env var names
	const ENV_KEY_MAP: Record<string, string> = {
		"anthropic-api": "ANTHROPIC_API_KEY",
		"gemini-api": "GOOGLE_AI_STUDIO_API_KEY",
	};
	const envKey =
		ENV_KEY_MAP[provider] ??
		provider.toUpperCase().replace(/-/g, "_") + "_API_KEY";
	const envValue = process.env[envKey];
	if (envValue && envValue.length > 0) {
		return envValue;
	}

	// Fall back to credentials resolver
	return resolveCredentialSync(provider);
}
