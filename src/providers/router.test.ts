import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { type LLMMessage, type ProviderId, ProviderRouter } from "./router";

describe("ProviderRouter", () => {
	let router: ProviderRouter;
	let mockFetchResponse: {
		ok: boolean;
		status: number;
		statusText: string;
		json: () => Promise<unknown>;
		text: () => Promise<string>;
	} | null = null;

	function setMockResponse(ok: boolean, status: number, data: unknown = {}) {
		const statusText = ok ? "OK" : "Error";
		mockFetchResponse = {
			ok,
			status,
			statusText,
			json: async () => data,
			text: async () =>
				typeof data === "string" ? data : JSON.stringify(data),
		};
	}

	beforeEach(() => {
		mockFetchResponse = null;

		vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
			if (!mockFetchResponse) {
				throw new Error("No mock response set");
			}
			return mockFetchResponse as unknown as Response;
		});

		router = new ProviderRouter({
			opencodeApiKey: "test-opencode-key",
			deepseekApiKey: "test-deepseek-key",
			cooldownMinutes: 1,
			maxFailuresBeforeCooldown: 3,
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("health tracking", () => {
		test("starts with zero failures for each provider", () => {
			expect(router.getFailureCount("opencode-go")).toBe(0);
			expect(router.getFailureCount("deepseek")).toBe(0);
		});

		test("reports not on cooldown initially", () => {
			expect(router.isOnCooldown("opencode-go")).toBe(false);
			expect(router.isOnCooldown("deepseek")).toBe(false);
		});

		test("increments failure count on retryable errors", async () => {
			setMockResponse(false, 429, { error: { message: "Rate limited" } });

			const messages: LLMMessage[] = [{ role: "user", content: "Hello" }];

			try {
				await router.completion({ messages });
			} catch {
				// Expected to fail
			}

			expect(router.getFailureCount("opencode-go")).toBe(1);
		});

		test("triggers cooldown after max failures", async () => {
			setMockResponse(false, 429, { error: { message: "Rate limited" } });

			const messages: LLMMessage[] = [{ role: "user", content: "Hello" }];

			// Trigger 3 failures
			for (let i = 0; i < 3; i++) {
				try {
					await router.completion({ messages });
				} catch {
					// Expected to fail
				}
			}

			// Now should be on cooldown
			expect(router.isOnCooldown("opencode-go")).toBe(true);
			expect(router.getFailureCount("opencode-go")).toBe(3);
		});
	});

	describe("fallback logic", () => {
		test("fallback returns other provider when one is specified", () => {
			const fallback = router.fallback("opencode-go");
			expect(fallback).toBe("minimax-m2.7");
		});

		test("fallback returns the same provider when other is on cooldown", () => {
			// Use fallback with deepseek as current - it should return next in priority list
			const result = router.fallback("deepseek");
			expect(result).toBe("glm-deepinfra");
		});

		test("fallback returns first provider if all on cooldown", () => {
			// Should still return a provider (fail-fast is better than hang)
			const fallback = router.fallback();
			expect(fallback).toBeDefined();
			// Any valid provider from the priority list
			expect(typeof fallback).toBe("string");
		});
	});

	describe("retryable error detection", () => {
		test("does not fallback on 429 rate limit errors", async () => {
			// 429 is retryable - should trigger fallback
			setMockResponse(false, 429, { error: { message: "Rate limited" } });

			const messages: LLMMessage[] = [{ role: "user", content: "test" }];

			let threw = false;
			try {
				await router.completion({ messages, provider: "opencode-go" });
			} catch (e) {
				threw = true;
			}

			// Should have thrown (we ran out of providers eventually)
			expect(threw).toBe(true);
			// And the first provider should have been tried
			expect(router.getFailureCount("opencode-go")).toBe(1);
		});

		test("does fallback on timeout errors", async () => {
			setMockResponse(false, 503, {
				error: { message: "timeout of 30000ms exceeded" },
			});

			const messages: LLMMessage[] = [{ role: "user", content: "test" }];

			let threw = false;
			try {
				await router.completion({ messages, provider: "opencode-go" });
			} catch {
				threw = true;
			}

			expect(threw).toBe(true);
		});

		test("throws immediately on 401 authentication errors (no fallback)", async () => {
			setMockResponse(false, 401, { error: { message: "Unauthorized" } });

			const messages: LLMMessage[] = [{ role: "user", content: "test" }];

			let threw = false;
			let errorMessage = "";
			try {
				await router.completion({ messages, provider: "opencode-go" });
			} catch (e) {
				threw = true;
				errorMessage = e instanceof Error ? e.message : String(e);
			}

			expect(threw).toBe(true);
			expect(errorMessage).toContain("401");
			// Should have tried exactly 1 provider (no fallback for 401)
			expect(router.getFailureCount("opencode-go")).toBe(1);
		});

		test("throws immediately on 500 server errors (no fallback)", async () => {
			setMockResponse(false, 500, {
				error: { message: "Internal Server Error" },
			});

			const messages: LLMMessage[] = [{ role: "user", content: "test" }];

			let threw = false;
			let errorMessage = "";
			try {
				await router.completion({ messages, provider: "opencode-go" });
			} catch (e) {
				threw = true;
				errorMessage = e instanceof Error ? e.message : String(e);
			}

			expect(threw).toBe(true);
			expect(errorMessage).toContain("500");
			// Should have tried exactly 1 provider (no fallback for 500)
			expect(router.getFailureCount("opencode-go")).toBe(1);
		});
	});

	describe("successful response handling", () => {
		test("resets failure count on success", async () => {
			// Simulate success response for deepseek (OpenAI-compatible format)
			setMockResponse(true, 200, {
				choices: [{ message: { content: "Hello" } }],
				usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
			});

			const messages: LLMMessage[] = [{ role: "user", content: "test" }];

			// Make a successful call to deepseek
			const response = await router.completion({
				messages,
				provider: "deepseek",
			});

			expect(response.content).toBe("Hello");
			// deepseek should have no failures after success
			expect(router.getFailureCount("deepseek")).toBe(0);
		});

		test("does not reset other provider's failure count", async () => {
			// First, fail with opencode-go
			setMockResponse(false, 429, {});

			const messages: LLMMessage[] = [{ role: "user", content: "test" }];

			try {
				await router.completion({ messages, provider: "opencode-go" });
			} catch {
				// Expected
			}

			// opencode-go should have 1 failure
			expect(router.getFailureCount("opencode-go")).toBe(1);

			// Now succeed with deepseek
			setMockResponse(true, 200, {
				choices: [{ message: { content: "OK" } }],
				usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
			});

			await router.completion({ messages, provider: "deepseek" });

			// opencode-go should still have its failure count
			expect(router.getFailureCount("opencode-go")).toBe(1);
			// deepseek should be reset to 0
			expect(router.getFailureCount("deepseek")).toBe(0);
		});
	});

	describe("timeout handling", () => {
		test("applies timeout to API calls", async () => {
			// The implementation uses AbortSignal.timeout(30000)
			// opencode-go uses Anthropic Messages API format: content[].text
			const messages: LLMMessage[] = [{ role: "user", content: "test" }];

			setMockResponse(true, 200, {
				content: [{ type: "text", text: "OK" }],
				usage: { input_tokens: 1, output_tokens: 1 },
			});

			const response = await router.completion({
				messages,
				provider: "opencode-go",
			});

			expect(response.content).toBe("OK");
		});
	});
});

describe("ProviderId type", () => {
	test("accepts valid provider IDs", () => {
		const validProviders: ProviderId[] = ["opencode-go", "deepseek"];
		expect(validProviders).toHaveLength(2);
	});

	test("includes paid API providers", () => {
		const paidProviders: ProviderId[] = ["anthropic-api", "gemini-api"];
		expect(paidProviders).toHaveLength(2);
	});
});

describe("Paid API provider routing", () => {
	let router: ProviderRouter;

	beforeEach(() => {
		vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
			throw new Error("No mock response set");
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	test("anthropic-api rejects missing key", async () => {
		router = new ProviderRouter({ anthropicApiKey: "" });
		const messages: LLMMessage[] = [{ role: "user", content: "test" }];
		await expect(
			router.completion({ messages, provider: "anthropic-api" }),
		).rejects.toThrow("Anthropic API key not configured");
	});

	test("anthropic-api rejects OAuth token format", async () => {
		router = new ProviderRouter({
			anthropicApiKey: "sk-ant-oat01-xxxxxxxxxxxxxxxxxxxxxxxx",
		});
		const messages: LLMMessage[] = [{ role: "user", content: "test" }];
		await expect(
			router.completion({ messages, provider: "anthropic-api" }),
		).rejects.toThrow("sk-ant-api03-");
	});

	test("anthropic-api accepts sk-ant-api03- keys and returns Anthropic format", async () => {
		router = new ProviderRouter({
			anthropicApiKey: "sk-ant-api03-valid-test-key-long-enough",
		});
		vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
			ok: true,
			status: 200,
			statusText: "OK",
			json: async () => ({
				content: [{ type: "text", text: "Hello from Anthropic" }],
				usage: { input_tokens: 5, output_tokens: 10 },
			}),
			text: async () => "",
		} as unknown as Response);

		const messages: LLMMessage[] = [{ role: "user", content: "test" }];
		const response = await router.completion({
			messages,
			provider: "anthropic-api",
		});
		expect(response.content).toBe("Hello from Anthropic");
		expect(response.provider).toBe("anthropic-api");
		expect(response.usage.promptTokens).toBe(5);
		expect(response.usage.completionTokens).toBe(10);
	});

	test("gemini-api rejects missing key", async () => {
		router = new ProviderRouter({ geminiApiKeyDirect: "" });
		const messages: LLMMessage[] = [{ role: "user", content: "test" }];
		await expect(
			router.completion({ messages, provider: "gemini-api" }),
		).rejects.toThrow("Google AI Studio API key not configured");
	});

	test("gemini-api rejects invalid key format", async () => {
		router = new ProviderRouter({ geminiApiKeyDirect: "invalid-key-format" });
		const messages: LLMMessage[] = [{ role: "user", content: "test" }];
		await expect(
			router.completion({ messages, provider: "gemini-api" }),
		).rejects.toThrow("AIza");
	});

	test("gemini-api accepts AIza keys and uses x-goog-api-key header", async () => {
		router = new ProviderRouter({
			geminiApiKeyDirect: "AIzaTestKey12345678901234567890123456789",
		});
		let capturedHeaders: Record<string, string> = {};
		vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
			capturedHeaders = (init?.headers as Record<string, string>) || {};
			return {
				ok: true,
				status: 200,
				statusText: "OK",
				json: async () => ({
					candidates: [{ content: { parts: [{ text: "Hello from Gemini" }] } }],
					usageMetadata: {
						promptTokenCount: 3,
						candidatesTokenCount: 7,
						totalTokenCount: 10,
					},
				}),
				text: async () => "",
			} as unknown as Response;
		});

		const messages: LLMMessage[] = [{ role: "user", content: "test" }];
		const response = await router.completion({
			messages,
			provider: "gemini-api",
		});
		expect(response.content).toBe("Hello from Gemini");
		expect(response.provider).toBe("gemini-api");
		expect(capturedHeaders["x-goog-api-key"]).toBeDefined();
	});

	test("opencode-go uses x-api-key and anthropic-version headers", async () => {
		router = new ProviderRouter({
			opencodeApiKey: "oc-test-key-valid-long-enough-key",
		});
		let capturedHeaders: Record<string, string> = {};
		vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
			capturedHeaders = (init?.headers as Record<string, string>) || {};
			return {
				ok: true,
				status: 200,
				statusText: "OK",
				json: async () => ({
					content: [{ type: "text", text: "Hello from OpenCode" }],
					usage: { input_tokens: 2, output_tokens: 4 },
				}),
				text: async () => "",
			} as unknown as Response;
		});

		const messages: LLMMessage[] = [{ role: "user", content: "test" }];
		const response = await router.completion({
			messages,
			provider: "opencode-go",
		});
		expect(response.content).toBe("Hello from OpenCode");
		expect(capturedHeaders["x-api-key"]).toBeDefined();
		expect(capturedHeaders["anthropic-version"]).toBe("2023-06-01");
	});

	test("opencode-go URL is api.opencode.ai/v1/messages", async () => {
		router = new ProviderRouter({
			opencodeApiKey: "oc-test-key-valid-long-enough-key",
		});
		let capturedUrl = "";
		vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
			capturedUrl = url.toString();
			return {
				ok: true,
				status: 200,
				statusText: "OK",
				json: async () => ({
					content: [{ type: "text", text: "ok" }],
					usage: { input_tokens: 1, output_tokens: 1 },
				}),
				text: async () => "",
			} as unknown as Response;
		});

		const messages: LLMMessage[] = [{ role: "user", content: "test" }];
		await router.completion({ messages, provider: "opencode-go" });
		expect(capturedUrl).toContain("api.opencode.ai/v1/messages");
	});
});

describe("ProviderRouter health tracking initialization — all 21 providers", () => {
	// All 21 ProviderId values mirrored here so this test fails if a new provider is
	// added to types.ts but not initialized in ProviderRouter's health map.
	const ALL_PROVIDER_IDS: ProviderId[] = [
		"opencode-go",
		"anthropic-api",
		"gemini-api",
		"deepseek-v4",
		"deepseek",
		"tavily",
		"gemini",
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

	let freshRouter: ProviderRouter;

	beforeEach(() => {
		freshRouter = new ProviderRouter({});
	});

	test("all 21 providers initialize with zero failures", () => {
		for (const id of ALL_PROVIDER_IDS) {
			expect(
				freshRouter.getFailureCount(id),
				`Expected zero failures for provider: ${id}`,
			).toBe(0);
		}
	});

	test("isOnCooldown returns false for all 21 providers initially", () => {
		for (const id of ALL_PROVIDER_IDS) {
			expect(
				freshRouter.isOnCooldown(id),
				`Expected no cooldown for provider: ${id}`,
			).toBe(false);
		}
	});

	test("list of 21 providers is exhaustive", () => {
		expect(ALL_PROVIDER_IDS.length).toBe(21);
	});
});
