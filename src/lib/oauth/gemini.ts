/**
 * Gemini OAuth Module
 * Supports credential reuse from ~/.gemini/oauth_creds.json and fresh Google OAuth flow
 */

import { chmodSync, existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	calculateExpiresAt,
	generateCodeChallenge,
	generateCodeVerifier,
	isTokenExpired,
	type OAuthToken,
} from "../oauth-pkce.js";
import { OAuthTokenStore } from "../oauth-token-store.js";

// Google OAuth endpoints for Gemini API
const GOOGLE_OAUTH_CONFIG = {
	authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
	tokenEndpoint: "https://oauth2.googleapis.com/token",
	// Scope for Gemini API - using generic OAuth for broader compatibility
	scope: "https://www.googleapis.com/auth/generative-language-tuner",
	// Default redirect URI for local callback
	redirectUri: "http://localhost:28564/callback",
};

/**
 * Path to Gemini CLI's existing OAuth credentials
 */
function getGeminiCliCredentialsPath(): string {
	return path.join(os.homedir(), ".gemini", "oauth_creds.json");
}

/**
 * Load credentials from Gemini CLI's existing OAuth file
 * This allows reusing existing authentication from the Gemini CLI
 */
export async function loadGeminiCliCredentials(): Promise<OAuthToken | null> {
	const credPath = getGeminiCliCredentialsPath();

	try {
		if (!existsSync(credPath)) {
			console.log("[OAuth:gemini] No existing Gemini CLI credentials found");
			return null;
		}

		const content = readFileSync(credPath, "utf-8");
		const parsed = JSON.parse(content);

		// Gemini CLI stores tokens in a different format - check common patterns
		// Pattern 1: { access_token, refresh_token, expiry }
		// Pattern 2: { token: { access_token, ... }, ... }

		let token: OAuthToken | null = null;

		// Try Pattern 1: Direct token object
		if (parsed.access_token && parsed.expiry) {
			token = {
				access_token: parsed.access_token,
				refresh_token: parsed.refresh_token,
				token_type: parsed.token_type || "Bearer",
				expires_at: parsed.expiry,
				scope: parsed.scope,
			};
		}
		// Try Pattern 2: Token wrapped in object
		else if (parsed.token && parsed.token.access_token) {
			const t = parsed.token;
			token = {
				access_token: t.access_token,
				refresh_token: t.refresh_token,
				token_type: t.token_type || "Bearer",
				expires_at: t.expiry || calculateExpiresAt(3600),
				scope: t.scope,
			};
		}
		// Try Pattern 3: Standard OAuth format
		else if (parsed.access_token && parsed.expires_at) {
			token = {
				access_token: parsed.access_token,
				refresh_token: parsed.refresh_token,
				token_type: parsed.token_type || "Bearer",
				expires_at: parsed.expires_at,
				scope: parsed.scope,
			};
		}

		if (token) {
			console.log("[OAuth:gemini] Loaded existing Gemini CLI credentials");
			console.log(
				`[OAuth:gemini] Token expires at: ${new Date(token.expires_at).toISOString()}`,
			);

			// Check if expired
			if (isTokenExpired(token)) {
				console.log("[OAuth:gemini] Existing token is expired");
				return null;
			}

			return token;
		}

		console.log("[OAuth:gemini] Unable to parse Gemini CLI credentials format");
		return null;
	} catch (error) {
		console.warn(
			"[OAuth:gemini] Failed to load Gemini CLI credentials:",
			error,
		);
		return null;
	}
}

/**
 * Get the path for storing Gemini OAuth tokens for Apohara
 */
function getApoharaTokenPath(): string {
	const xdgConfig = process.env.XDG_CONFIG_HOME;
	if (xdgConfig) {
		return path.join(xdgConfig, "apohara", "oauth-gemini.json");
	}
	return path.join(os.homedir(), ".apohara", "oauth-gemini.json");
}

/**
 * Load Apohara's stored Gemini OAuth token
 */
export async function loadApoharaToken(): Promise<OAuthToken | null> {
	const tokenPath = getApoharaTokenPath();

	try {
		if (!existsSync(tokenPath)) {
			return null;
		}

		const content = await readFile(tokenPath, "utf-8");
		const token = JSON.parse(content) as OAuthToken;

		if (!token.access_token || !token.expires_at) {
			return null;
		}

		return token;
	} catch (error) {
		console.warn("[OAuth:gemini] Failed to load Apohara token:", error);
		return null;
	}
}

/**
 * Save token to Apohara's credential store
 */
export async function saveApoharaToken(token: OAuthToken): Promise<void> {
	const tokenPath = getApoharaTokenPath();
	const dir = path.dirname(tokenPath);

	try {
		await mkdir(dir, { recursive: true });
		await writeFile(tokenPath, JSON.stringify(token, null, 2), "utf-8");
		chmodSync(tokenPath, 0o600);
		console.log("[OAuth:gemini] Token saved to Apohara credentials store");
	} catch (error) {
		console.error("[OAuth:gemini] Failed to save token:", error);
		throw error;
	}
}

/**
 * Clear stored token
 */
export async function clearApoharaToken(): Promise<void> {
	const tokenPath = getApoharaTokenPath();

	try {
		const { unlink } = await import("node:fs/promises");
		await unlink(tokenPath);
		console.log("[OAuth:gemini] Token cleared from Apohara store");
	} catch {
		// File doesn't exist - that's fine
	}
}

/**
 * Start a local HTTP server to receive OAuth callback
 */
function startCallbackServer(port: number): Promise<{
	server: ReturnType<typeof import("http").createServer>;
	code: Promise<string | null>;
}> {
	return new Promise((resolve, reject) => {
		const http = require("http");

		let resolveCode: (code: string | null) => void;
		const codePromise = new Promise<string | null>((res) => {
			resolveCode = res;
		});

		const server = http.createServer(
			// http is loaded via require() so the runtime types aren't in
			// scope as a namespace; the callback shape is inferred from
			// createServer's signature.
			// biome-ignore lint/suspicious/noExplicitAny: see comment above
			(req: any, res: any) => {
				const url = new URL(req.url || "/", `http://localhost:${port}`);

				if (url.pathname === "/callback" || url.pathname === "") {
					const code = url.searchParams.get("code");
					const error = url.searchParams.get("error");

					if (error) {
						res.writeHead(400, { "Content-Type": "text/html" });
						res.end(
							"<html><body><h1>Authentication Failed</h1><p>Error: " +
								error +
								"</p></body></html>",
						);
						resolveCode(null);
						server.close();
						return;
					}

					if (code) {
						res.writeHead(200, { "Content-Type": "text/html" });
						res.end(
							"<html><body><h1>Authentication Successful!</h1><p>You may close this window.</p></body></html>",
						);
						resolveCode(code);
						server.close();
						return;
					}

					res.writeHead(400, { "Content-Type": "text/html" });
					res.end(
						"<html><body><h1>Error</h1><p>No authorization code received.</p></body></html>",
					);
					server.close();
				} else {
					res.writeHead(404, { "Content-Type": "text/plain" });
					res.end("Not found");
				}
			},
		);

		server.listen(port, () => {
			// Server ready
		});

		server.on("error", reject);

		// Timeout after 5 minutes
		setTimeout(
			() => {
				server.close();
				reject(new Error("OAuth callback timed out"));
			},
			5 * 60 * 1000,
		);

		resolve({ server, code: codePromise });
	});
}

/**
 * Open URL in default browser
 */
async function openBrowser(url: string): Promise<void> {
	const { exec } = require("child_process");
	const platform = process.platform;

	let command: string;
	if (platform === "darwin") {
		command = `open "${url}"`;
	} else if (platform === "win32") {
		command = `start "" "${url}"`;
	} else {
		command = `xdg-open "${url}"`;
	}

	return new Promise((resolve, reject) => {
		exec(command, (error: Error | null) => {
			if (error) {
				console.error("[OAuth:gemini] Failed to open browser:", error.message);
				reject(error);
			} else {
				resolve();
			}
		});
	});
}

/**
 * Find an available port in a range
 */
async function findAvailablePort(start: number, end: number): Promise<number> {
	const net = require("net");

	for (let port = start; port <= end; port++) {
		const available = await new Promise<boolean>((resolve) => {
			const server = net.createServer();
			server.once("error", () => resolve(false));
			server.once("listening", () => {
				server.close();
				resolve(true);
			});
			server.listen(port);
		});

		if (available) {
			return port;
		}
	}

	throw new Error("No available port found in range");
}

/**
 * Perform Google OAuth login flow for Gemini API
 * @param clientId - OAuth client ID
 * @param clientSecret - OAuth client secret (optional for some flows)
 */
export async function loginWithGoogleOAuth(
	clientId: string,
	clientSecret?: string,
): Promise<OAuthToken> {
	console.log("[OAuth:gemini] Starting Google OAuth login flow...");

	// Generate PKCE verifier and challenge
	const codeVerifier = generateCodeVerifier();
	const codeChallenge = generateCodeChallenge(codeVerifier);

	console.log("[OAuth:gemini] Generated PKCE code_verifier and code_challenge");

	// Find an available port for callback
	const callbackPort = await findAvailablePort(28564, 28599);
	const redirectUri = `${GOOGLE_OAUTH_CONFIG.redirectUri}:${callbackPort}/callback`;

	console.log(
		`[OAuth:gemini] Starting callback server on port ${callbackPort}...`,
	);

	// Start callback server
	const { server, code: codePromise } = await startCallbackServer(callbackPort);

	try {
		// Build authorization URL
		const authUrl = new URL(GOOGLE_OAUTH_CONFIG.authorizationEndpoint);
		authUrl.searchParams.set("client_id", clientId);
		authUrl.searchParams.set("redirect_uri", redirectUri);
		authUrl.searchParams.set("response_type", "code");
		authUrl.searchParams.set("scope", GOOGLE_OAUTH_CONFIG.scope);
		authUrl.searchParams.set("code_challenge", codeChallenge);
		authUrl.searchParams.set("code_challenge_method", "S256");
		authUrl.searchParams.set("access_type", "offline"); // Request refresh token
		authUrl.searchParams.set("prompt", "consent"); // Force consent to get refresh token

		console.log("[OAuth:gemini] Opening browser for authentication...");
		console.log(
			`[OAuth:gemini] Authorization URL: ${authUrl.toString().replace(clientId, "***")}`,
		);

		// Open browser
		await openBrowser(authUrl.toString());

		console.log("[OAuth:gemini] Waiting for authorization code...");

		// Wait for authorization code
		const authCode = await codePromise;

		if (!authCode) {
			throw new Error("No authorization code received");
		}

		console.log(
			"[OAuth:gemini] Received authorization code, exchanging for tokens...",
		);

		// Exchange code for tokens
		const tokenResponse = await fetch(GOOGLE_OAUTH_CONFIG.tokenEndpoint, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: new URLSearchParams({
				grant_type: "authorization_code",
				code: authCode,
				redirect_uri: redirectUri,
				client_id: clientId,
				code_verifier: codeVerifier,
				...(clientSecret && { client_secret: clientSecret }),
			}),
		});

		if (!tokenResponse.ok) {
			const errorText = await tokenResponse.text();
			throw new Error(
				`Token exchange failed: ${tokenResponse.status} ${errorText}`,
			);
		}

		const tokenData = (await tokenResponse.json()) as {
			access_token: string;
			refresh_token?: string;
			token_type: string;
			expires_in: number;
			scope?: string;
		};

		// Calculate expiration
		const expiresAt = calculateExpiresAt(tokenData.expires_in);

		const token: OAuthToken = {
			access_token: tokenData.access_token,
			refresh_token: tokenData.refresh_token,
			token_type: tokenData.token_type,
			expires_at: expiresAt,
			scope: tokenData.scope,
		};

		console.log("[OAuth:gemini] OAuth flow completed successfully");
		return token;
	} finally {
		server.close();
	}
}

/**
 * Refresh the OAuth token using the refresh token
 */
export async function refreshGeminiToken(
	refreshToken: string,
	clientId: string,
	clientSecret?: string,
): Promise<OAuthToken> {
	const tokenResponse = await fetch(GOOGLE_OAUTH_CONFIG.tokenEndpoint, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: refreshToken,
			client_id: clientId,
			...(clientSecret && { client_secret: clientSecret }),
		}),
	});

	if (!tokenResponse.ok) {
		const errorText = await tokenResponse.text();
		throw new Error(
			`Token refresh failed: ${tokenResponse.status} ${errorText}`,
		);
	}

	const tokenData = (await tokenResponse.json()) as {
		access_token: string;
		refresh_token?: string;
		token_type: string;
		expires_in: number;
		scope?: string;
	};

	return {
		access_token: tokenData.access_token,
		refresh_token: tokenData.refresh_token || refreshToken,
		token_type: tokenData.token_type,
		expires_at: calculateExpiresAt(tokenData.expires_in),
		scope: tokenData.scope,
	};
}

/**
 * Get or create an OAuth token store for Gemini
 */
export function createGeminiTokenStore(
	clientId: string,
	clientSecret?: string,
): OAuthTokenStore {
	return new OAuthTokenStore(
		{ provider: "gemini" },
		async (refreshToken: string) => {
			return refreshGeminiToken(refreshToken, clientId, clientSecret);
		},
	);
}

/**
 * Check if we have valid Gemini credentials (either from Gemini CLI or Apohara store)
 */
export async function hasValidGeminiCredentials(): Promise<boolean> {
	// First check Gemini CLI credentials
	const cliCredentials = await loadGeminiCliCredentials();
	if (cliCredentials && !isTokenExpired(cliCredentials)) {
		return true;
	}

	// Then check Apohara store
	const apoharaToken = await loadApoharaToken();
	if (apoharaToken && !isTokenExpired(apoharaToken)) {
		return true;
	}

	return false;
}

/**
 * Get a valid Gemini access token
 * Priority: 1. Gemini CLI credentials, 2. Apohara stored token, 3. null
 */
export async function getGeminiAccessToken(): Promise<string | null> {
	// First check Gemini CLI credentials
	const cliCredentials = await loadGeminiCliCredentials();
	if (cliCredentials && !isTokenExpired(cliCredentials)) {
		console.log("[OAuth:gemini] Using credentials from Gemini CLI");
		return cliCredentials.access_token;
	}

	// Then check Apohara store
	const apoharaToken = await loadApoharaToken();
	if (apoharaToken && !isTokenExpired(apoharaToken)) {
		console.log("[OAuth:gemini] Using credentials from Apohara store");
		return apoharaToken.access_token;
	}

	return null;
}

/**
 * Get sanitized token info for logging
 */
export async function getGeminiTokenInfo(): Promise<Record<string, unknown>> {
	// Check Gemini CLI first
	const cliCredentials = await loadGeminiCliCredentials();
	if (cliCredentials) {
		return {
			provider: "gemini",
			source: "gemini-cli",
			present: true,
			token_type: cliCredentials.token_type,
			expires_at: new Date(cliCredentials.expires_at).toISOString(),
			is_expired: isTokenExpired(cliCredentials),
			has_refresh_token: !!cliCredentials.refresh_token,
		};
	}

	// Check Apohara store
	const apoharaToken = await loadApoharaToken();
	if (apoharaToken) {
		return {
			provider: "gemini",
			source: "apohara",
			present: true,
			token_type: apoharaToken.token_type,
			expires_at: new Date(apoharaToken.expires_at).toISOString(),
			is_expired: isTokenExpired(apoharaToken),
			has_refresh_token: !!apoharaToken.refresh_token,
		};
	}

	return {
		provider: "gemini",
		present: false,
		source: null,
	};
}
