import { describe, expect, test } from "vitest";
import { validateApiKeyFormat } from "../core/credentials";

describe("validateApiKeyFormat", () => {
	describe("empty / missing values", () => {
		test("returns valid for empty string (user can skip)", () => {
			expect(validateApiKeyFormat("ANTHROPIC_API_KEY", "")).toEqual({
				valid: true,
			});
		});

		test("returns valid for empty string on any key name", () => {
			expect(validateApiKeyFormat("GOOGLE_AI_STUDIO_API_KEY", "")).toEqual({
				valid: true,
			});
			expect(validateApiKeyFormat("OPENCODE_API_KEY", "")).toEqual({
				valid: true,
			});
		});
	});

	describe("ANTHROPIC_API_KEY", () => {
		test("accepts valid sk-ant-api03- key with sufficient length", () => {
			const validKey = "sk-ant-api03-" + "a".repeat(30); // 13 + 30 = 43 chars
			expect(validateApiKeyFormat("ANTHROPIC_API_KEY", validKey)).toEqual({
				valid: true,
			});
		});

		test("rejects OAuth token format sk-ant-oat01-*", () => {
			const oauthToken = "sk-ant-oat01-" + "x".repeat(40);
			const result = validateApiKeyFormat("ANTHROPIC_API_KEY", oauthToken);
			expect(result.valid).toBe(false);
			expect(result.error).toContain("sk-ant-api03-");
			expect(result.error).toContain("OAuth tokens");
		});

		test("rejects generic sk- prefix (not api03)", () => {
			const wrongPrefix = "sk-ant-other-" + "x".repeat(40);
			const result = validateApiKeyFormat("ANTHROPIC_API_KEY", wrongPrefix);
			expect(result.valid).toBe(false);
			expect(result.error).toContain("sk-ant-api03-");
		});

		test("rejects random string", () => {
			const result = validateApiKeyFormat("ANTHROPIC_API_KEY", "notavalidkey");
			expect(result.valid).toBe(false);
		});

		test("rejects key that is too short (under 40 chars)", () => {
			const shortKey = "sk-ant-api03-short";
			const result = validateApiKeyFormat("ANTHROPIC_API_KEY", shortKey);
			expect(result.valid).toBe(false);
			expect(result.error).toContain("too short");
		});

		test("error message is sanitized (does not reveal full key)", () => {
			const oauthToken = "sk-ant-oat01-secrettoken1234567890abcdef";
			const result = validateApiKeyFormat("ANTHROPIC_API_KEY", oauthToken);
			expect(result.error).not.toContain("secrettoken");
		});
	});

	describe("OPENCODE_API_KEY", () => {
		test("accepts oc- prefix key with sufficient length", () => {
			const validKey = "oc-" + "a".repeat(20); // 3 + 20 = 23 chars
			expect(validateApiKeyFormat("OPENCODE_API_KEY", validKey)).toEqual({
				valid: true,
			});
		});

		test("accepts opencode- prefix key with sufficient length", () => {
			const validKey = "opencode-" + "a".repeat(20);
			expect(validateApiKeyFormat("OPENCODE_API_KEY", validKey)).toEqual({
				valid: true,
			});
		});

		test("rejects key without oc- or opencode- prefix", () => {
			const result = validateApiKeyFormat(
				"OPENCODE_API_KEY",
				"invalid-key-format-here",
			);
			expect(result.valid).toBe(false);
			expect(result.error).toContain("oc-");
			expect(result.error).toContain("opencode-");
		});

		test("rejects key that is too short (under 20 chars)", () => {
			const shortKey = "oc-short";
			const result = validateApiKeyFormat("OPENCODE_API_KEY", shortKey);
			expect(result.valid).toBe(false);
			expect(result.error).toContain("too short");
		});

		test("rejects sk-ant- key passed to OpenCode slot", () => {
			const result = validateApiKeyFormat(
				"OPENCODE_API_KEY",
				"sk-ant-api03-wrong-slot-key-padding",
			);
			expect(result.valid).toBe(false);
		});
	});

	describe("GOOGLE_AI_STUDIO_API_KEY", () => {
		// Valid Google AI Studio keys: AIza + exactly 35 chars = 39 total
		const VALID_GOOGLE_KEY = "AIza" + "A".repeat(35);

		test("accepts exactly 39-char AIza key", () => {
			expect(VALID_GOOGLE_KEY).toHaveLength(39);
			expect(
				validateApiKeyFormat("GOOGLE_AI_STUDIO_API_KEY", VALID_GOOGLE_KEY),
			).toEqual({ valid: true });
		});

		test("rejects key without AIza prefix", () => {
			const result = validateApiKeyFormat(
				"GOOGLE_AI_STUDIO_API_KEY",
				"Biza" + "A".repeat(35),
			);
			expect(result.valid).toBe(false);
			expect(result.error).toContain("AIza");
		});

		test("rejects key that is too short (< 39 chars)", () => {
			const shortKey = "AIza" + "A".repeat(30); // 34 chars
			const result = validateApiKeyFormat("GOOGLE_AI_STUDIO_API_KEY", shortKey);
			expect(result.valid).toBe(false);
			expect(result.error).toContain("39 characters");
		});

		test("rejects key that is too long (> 39 chars)", () => {
			const longKey = "AIza" + "A".repeat(40); // 44 chars
			const result = validateApiKeyFormat("GOOGLE_AI_STUDIO_API_KEY", longKey);
			expect(result.valid).toBe(false);
			expect(result.error).toContain("39 characters");
		});

		test("rejects random string", () => {
			const result = validateApiKeyFormat(
				"GOOGLE_AI_STUDIO_API_KEY",
				"notavalidgooglekey",
			);
			expect(result.valid).toBe(false);
		});
	});

	describe("OPENAI_API_KEY", () => {
		test("accepts sk- prefix key with sufficient length", () => {
			const validKey = "sk-" + "a".repeat(50);
			expect(validateApiKeyFormat("OPENAI_API_KEY", validKey)).toEqual({
				valid: true,
			});
		});

		test("accepts sk-proj- prefix key", () => {
			const validKey = "sk-proj-" + "a".repeat(50);
			expect(validateApiKeyFormat("OPENAI_API_KEY", validKey)).toEqual({
				valid: true,
			});
		});

		test("rejects key without sk- prefix", () => {
			const result = validateApiKeyFormat(
				"OPENAI_API_KEY",
				"openai-wrongprefix-" + "x".repeat(40),
			);
			expect(result.valid).toBe(false);
			expect(result.error).toContain("sk-");
		});

		test("rejects key that is too short", () => {
			const result = validateApiKeyFormat("OPENAI_API_KEY", "sk-short");
			expect(result.valid).toBe(false);
			expect(result.error).toContain("too short");
		});
	});

	describe("DEEPSEEK_API_KEY", () => {
		test("accepts sk- prefix key with sufficient length", () => {
			const validKey = "sk-" + "a".repeat(20);
			expect(validateApiKeyFormat("DEEPSEEK_API_KEY", validKey)).toEqual({
				valid: true,
			});
		});

		test("accepts deepseek- prefix key", () => {
			const validKey = "deepseek-" + "a".repeat(20);
			expect(validateApiKeyFormat("DEEPSEEK_API_KEY", validKey)).toEqual({
				valid: true,
			});
		});

		test("rejects key without recognized prefix", () => {
			const result = validateApiKeyFormat(
				"DEEPSEEK_API_KEY",
				"ds-wrongprefix-" + "x".repeat(20),
			);
			expect(result.valid).toBe(false);
		});

		test("rejects key that is too short", () => {
			const result = validateApiKeyFormat("DEEPSEEK_API_KEY", "sk-short");
			expect(result.valid).toBe(false);
			expect(result.error).toContain("too short");
		});
	});

	describe("unknown / default key names", () => {
		test("accepts key with at least 10 characters", () => {
			expect(
				validateApiKeyFormat("SOME_OTHER_API_KEY", "longenoughkey"),
			).toEqual({ valid: true });
		});

		test("rejects key shorter than 10 characters", () => {
			const result = validateApiKeyFormat("SOME_OTHER_API_KEY", "short");
			expect(result.valid).toBe(false);
			expect(result.error).toContain("too short");
		});
	});

	describe("cross-provider format confusion", () => {
		test("rejects Anthropic key in Google slot (wrong length)", () => {
			const anthropicKey = "sk-ant-api03-" + "a".repeat(30);
			const result = validateApiKeyFormat(
				"GOOGLE_AI_STUDIO_API_KEY",
				anthropicKey,
			);
			expect(result.valid).toBe(false);
		});

		test("rejects Google key in Anthropic slot (wrong prefix)", () => {
			const googleKey = "AIza" + "A".repeat(35);
			const result = validateApiKeyFormat("ANTHROPIC_API_KEY", googleKey);
			expect(result.valid).toBe(false);
		});

		test("rejects OpenCode key in Anthropic slot (wrong prefix)", () => {
			const opencodeKey = "oc-" + "a".repeat(40);
			const result = validateApiKeyFormat("ANTHROPIC_API_KEY", opencodeKey);
			expect(result.valid).toBe(false);
		});
	});
});
