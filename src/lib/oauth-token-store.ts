/**
 * OAuth Token Store
 * Persistent storage and refresh logic for OAuth tokens
 */

import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { isTokenExpired, type OAuthToken } from "./oauth-pkce";

/**
 * Token store configuration
 */
export interface TokenStoreConfig {
	provider: string;
	tokenPath?: string;
}

/**
 * Token refresh handler function type
 */
export type TokenRefreshHandler = (refreshToken: string) => Promise<OAuthToken>;

/**
 * OAuth Token Store with persistence and auto-refresh
 */
export class OAuthTokenStore {
	private provider: string;
	private tokenPath: string;
	private refreshHandler?: TokenRefreshHandler;
	private token: OAuthToken | null = null;
	private refreshPromise?: Promise<OAuthToken>;

	constructor(config: TokenStoreConfig, refreshHandler?: TokenRefreshHandler) {
		this.provider = config.provider;
		// Use oauth-${provider}.json to match auth command path
		this.tokenPath =
			config.tokenPath ||
			path.join(os.homedir(), ".apohara", `oauth-${config.provider}.json`);
		this.refreshHandler = refreshHandler;
	}

	/**
	 * Initialize the token store - load existing token from disk
	 */
	async initialize(): Promise<OAuthToken | null> {
		this.token = await this.loadToken();
		return this.token;
	}

	/**
	 * Get the current token, optionally refreshing if expired
	 * @param forceRefresh - Force token refresh regardless of expiration
	 */
	async getToken(forceRefresh: boolean = false): Promise<OAuthToken | null> {
		// Ensure token is loaded
		if (!this.token) {
			await this.initialize();
		}

		if (!this.token) {
			return null;
		}

		// Check if we need to refresh
		if (forceRefresh || (this.refreshHandler && isTokenExpired(this.token))) {
			if (!this.refreshHandler) {
				// No refresh handler - token is expired and cannot be refreshed
				console.log(
					`[OAuth:${this.provider}] Token expired, no refresh handler available`,
				);
				return null;
			}

			// Prevent multiple simultaneous refreshes
			if (!this.refreshPromise) {
				this.refreshPromise = this.refreshToken();
			}

			try {
				const newToken = await this.refreshPromise;
				this.token = newToken;
				await this.saveToken(newToken);
				console.log(`[OAuth:${this.provider}] Token refreshed successfully`);
			} catch (error) {
				console.error(`[OAuth:${this.provider}] Token refresh failed:`, error);
				this.refreshPromise = undefined;
				return null;
			} finally {
				this.refreshPromise = undefined;
			}
		}

		return this.token;
	}

	/**
	 * Set a new token and persist it
	 */
	async setToken(token: OAuthToken): Promise<void> {
		this.token = token;
		await this.saveToken(token);
		console.log(
			`[OAuth:${this.provider}] Token stored, expires at ${new Date(token.expires_at).toISOString()}`,
		);
	}

	/**
	 * Clear the stored token
	 */
	async clearToken(): Promise<void> {
		this.token = null;
		try {
			const { unlink } = await import("node:fs/promises");
			await unlink(this.tokenPath);
			console.log(`[OAuth:${this.provider}] Token cleared`);
		} catch {
			// File doesn't exist - that's fine
		}
	}

	/**
	 * Check if a valid token exists
	 */
	hasToken(): boolean {
		return this.token !== null && !isTokenExpired(this.token);
	}

	/**
	 * Get sanitized token info for logging
	 */
	getSanitizedInfo(): Record<string, unknown> {
		if (!this.token) {
			return { provider: this.provider, present: false };
		}

		return {
			provider: this.provider,
			present: true,
			token_type: this.token.token_type,
			expires_at: new Date(this.token.expires_at).toISOString(),
			has_refresh_token: !!this.token.refresh_token,
		};
	}

	private async refreshToken(): Promise<OAuthToken> {
		if (!this.token?.refresh_token) {
			throw new Error("No refresh token available");
		}

		if (!this.refreshHandler) {
			throw new Error("No refresh handler configured");
		}

		return this.refreshHandler(this.token.refresh_token);
	}

	private async loadToken(): Promise<OAuthToken | null> {
		try {
			if (!existsSync(this.tokenPath)) {
				return null;
			}

			const content = readFileSync(this.tokenPath, "utf-8");
			const parsed = JSON.parse(content) as OAuthToken;

			// Validate token has required fields
			if (!parsed.access_token || !parsed.expires_at) {
				console.warn(`[OAuth:${this.provider}] Invalid token file format`);
				return null;
			}

			return parsed;
		} catch (error) {
			console.warn(`[OAuth:${this.provider}] Failed to load token:`, error);
			return null;
		}
	}

	private async saveToken(token: OAuthToken): Promise<void> {
		try {
			const dir = path.dirname(this.tokenPath);
			await mkdir(dir, { recursive: true });
			await writeFile(this.tokenPath, JSON.stringify(token, null, 2), "utf-8");
		} catch (error) {
			console.error(`[OAuth:${this.provider}] Failed to save token:`, error);
			throw error;
		}
	}
}

/**
 * Factory to create a token store with built-in refresh logic
 */
export function createOAuthTokenStore(
	provider: string,
	tokenEndpoint: string,
	clientId: string,
	clientSecret?: string,
): OAuthTokenStore {
	return new OAuthTokenStore({ provider }, async (refreshToken: string) => {
		const response = await fetch(tokenEndpoint, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				...(clientSecret && {
					Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
				}),
			},
			body: new URLSearchParams({
				grant_type: "refresh_token",
				refresh_token: refreshToken,
				...(clientSecret && { client_id: clientId }),
			}),
		});

		if (!response.ok) {
			throw new Error(
				`Token refresh failed: ${response.status} ${response.statusText}`,
			);
		}

		const data = (await response.json()) as {
			access_token: string;
			refresh_token?: string;
			token_type: string;
			expires_in: number;
			scope?: string;
		};

		// Calculate new expiration time
		const expires_at = Date.now() + data.expires_in * 1000;

		return {
			access_token: data.access_token,
			refresh_token: data.refresh_token || refreshToken, // Use new refresh token if provided
			token_type: data.token_type,
			expires_at,
			scope: data.scope,
		};
	});
}
