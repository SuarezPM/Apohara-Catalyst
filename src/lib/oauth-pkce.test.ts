/**
 * Unit tests for OAuth PKCE utilities
 */

import { describe, expect, it } from "vitest";
import {
	base64urlDecode,
	base64urlEncode,
	calculateExpiresAt,
	generateCodeChallenge,
	generateCodeVerifier,
	isTokenExpired,
	sanitizeTokenForLogging,
} from "./oauth-pkce";

describe("OAuth PKCE Utilities", () => {
	describe("base64urlEncode", () => {
		it("encodes bytes to base64url without padding", () => {
			const input = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
			const result = base64urlEncode(input);
			expect(result).toBe("SGVsbG8");
		});

		it("handles URL-safe characters", () => {
			// Input that would produce + and / in standard base64
			const input = new Uint8Array([255, 254, 253]);
			const result = base64urlEncode(input);
			// Should use - and _ instead of + and /
			expect(result).not.toContain("+");
			expect(result).not.toContain("/");
		});

		it("produces correct length for 32 bytes", () => {
			const input = new Uint8Array(32);
			const result = base64urlEncode(input);
			// 32 bytes -> 43 base64url characters (no padding)
			expect(result.length).toBe(43);
		});
	});

	describe("base64urlDecode", () => {
		it("decodes base64url back to original bytes", () => {
			const original = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
			const encoded = base64urlEncode(original);
			const decoded = base64urlDecode(encoded);
			expect(decoded).toEqual(Buffer.from(original));
		});

		it("handles URL-safe characters", () => {
			// base64url string with - and _
			const encoded = "SGVsbG8-abc_test";
			const decoded = base64urlDecode(encoded);
			expect(decoded.length).toBeGreaterThan(0);
		});
	});

	describe("generateCodeVerifier", () => {
		it("generates a 43-character base64url string", () => {
			const verifier = generateCodeVerifier();
			expect(verifier.length).toBe(43);
		});

		it("generates unique verifiers each time", () => {
			const verifier1 = generateCodeVerifier();
			const verifier2 = generateCodeVerifier();
			expect(verifier1).not.toBe(verifier2);
		});

		it("only contains base64url-safe characters", () => {
			const verifier = generateCodeVerifier();
			expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
		});
	});

	describe("generateCodeChallenge", () => {
		it("generates SHA256 hash as base64url", () => {
			const verifier = generateCodeVerifier();
			const challenge = generateCodeChallenge(verifier);
			expect(challenge.length).toBe(43);
			expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
		});

		it("produces deterministic output for same input", () => {
			const verifier = "test-verifier-string";
			const challenge1 = generateCodeChallenge(verifier);
			const challenge2 = generateCodeChallenge(verifier);
			expect(challenge1).toBe(challenge2);
		});

		it("produces different output for different inputs", () => {
			const challenge1 = generateCodeChallenge("verifier-one");
			const challenge2 = generateCodeChallenge("verifier-two");
			expect(challenge1).not.toBe(challenge2);
		});
	});

	describe("isTokenExpired", () => {
		it("returns true for expired token", () => {
			const token = {
				access_token: "test",
				token_type: "Bearer",
				expires_at: Date.now() - 1000, // 1 second ago
			};
			expect(isTokenExpired(token)).toBe(true);
		});

		it("returns true for token expiring within buffer", () => {
			const token = {
				access_token: "test",
				token_type: "Bearer",
				expires_at: Date.now() + 30000, // 30 seconds from now
			};
			// With default 60s buffer, this is considered expired
			expect(isTokenExpired(token)).toBe(true);
		});

		it("returns false for valid token with custom buffer", () => {
			const token = {
				access_token: "test",
				token_type: "Bearer",
				expires_at: Date.now() + 300000, // 5 minutes from now
			};
			// With 60s buffer, this is still valid
			expect(isTokenExpired(token, 60)).toBe(false);
		});

		it("returns false for token expiring beyond buffer", () => {
			const token = {
				access_token: "test",
				token_type: "Bearer",
				expires_at: Date.now() + 120000, // 2 minutes from now
			};
			expect(isTokenExpired(token, 60)).toBe(false);
		});
	});

	describe("calculateExpiresAt", () => {
		it("calculates future timestamp from expires_in", () => {
			const before = Date.now();
			const expiresAt = calculateExpiresAt(3600); // 1 hour
			const after = Date.now();

			expect(expiresAt).toBeGreaterThanOrEqual(before + 3600 * 1000);
			expect(expiresAt).toBeLessThanOrEqual(after + 3600 * 1000);
		});

		it("handles small expires_in values", () => {
			const expiresAt = calculateExpiresAt(1);
			const now = Date.now();
			expect(expiresAt).toBeGreaterThan(now);
			expect(expiresAt).toBeLessThan(now + 2000);
		});
	});

	describe("sanitizeTokenForLogging", () => {
		it("returns null indicator for null token", () => {
			const result = sanitizeTokenForLogging(null);
			expect(result.present).toBe(false);
		});

		it("redacts access and refresh tokens", () => {
			const token = {
				access_token: "secret-access-token",
				refresh_token: "secret-refresh-token",
				token_type: "Bearer",
				expires_at: Date.now() + 3600000,
				scope: "read write",
			};
			const result = sanitizeTokenForLogging(token);
			expect(result).not.toHaveProperty("access_token");
			expect(result).not.toHaveProperty("refresh_token");
			expect(result.token_type).toBe("Bearer");
			expect(result.expires_at).toBeDefined();
			expect(result.has_refresh_token).toBe(true);
		});

		it("handles token without refresh token", () => {
			const token = {
				access_token: "test",
				token_type: "Bearer",
				expires_at: Date.now() + 3600000,
			};
			const result = sanitizeTokenForLogging(token);
			expect(result.has_refresh_token).toBe(false);
		});
	});
});
