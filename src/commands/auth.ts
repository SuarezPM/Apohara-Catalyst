/**
 * Auth command - OAuth authentication for Claude.ai and other providers
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Command } from "commander";
import {
	calculateExpiresAt,
	generateCodeChallenge,
	generateCodeVerifier,
} from "../lib/oauth-pkce.js";

// Claude.ai OAuth configuration
const CLAUDE_OAUTH_CONFIG = {
	authorizationEndpoint: "https://claude.ai/api/oauth/authorize",
	tokenEndpoint: "https://claude.ai/api/oauth/token",
	clientId: "", // Will be loaded from credentials
	scope: "api",
};

// Default redirect URI for local callback
const DEFAULT_REDIRECT_URI = "http://localhost:28563/callback";

/**
 * Get credentials path for storing OAuth tokens
 */
function getOAuthCredentialsPath(provider: string): string {
	const xdgConfig = process.env.XDG_CONFIG_HOME;
	if (xdgConfig) {
		return path.join(xdgConfig, "apohara", `oauth-${provider}.json`);
	}
	return path.join(os.homedir(), ".apohara", `oauth-${provider}.json`);
}

/**
 * Load client ID from credentials file
 */
async function loadClientId(): Promise<string> {
	const xdgConfig = process.env.XDG_CONFIG_HOME;
	const credPath = xdgConfig
		? path.join(xdgConfig, "apohara", "credentials.json")
		: path.join(os.homedir(), ".apohara", "credentials.json");

	try {
		const content = await fs.readFile(credPath, "utf-8");
		const parsed = JSON.parse(content);
		return parsed["claude-oauth-client-id"] || "";
	} catch {
		return "";
	}
}

/**
 * Start a local HTTP server to receive OAuth callback
 */
function startCallbackServer(port: number): Promise<{
	server: ReturnType<typeof import("http").createServer>;
	code: Promise<string>;
}> {
	return new Promise((resolve, reject) => {
		const http = require("http");

		let resolveCode: (code: string) => void;
		const codePromise = new Promise<string>((res) => {
			resolveCode = res;
		});

		const server = http.createServer(
			// http is loaded via require() so the runtime types aren't in
			// scope as a namespace; the callback shape is inferred from
			// createServer's signature.
			// biome-ignore lint/suspicious/noExplicitAny: see comment above
			(req: any, res: any) => {
				const url = new URL(req.url || "/", `http://localhost:${port}`);

				if (url.pathname === "/callback") {
					const code = url.searchParams.get("code");
					const error = url.searchParams.get("error");

					if (error) {
						res.writeHead(400, { "Content-Type": "text/html" });
						res.end(
							"<html><body><h1>Authentication Failed</h1><p>Error: " +
								error +
								"</p></body></html>",
						);
						resolveCode(null as unknown as string);
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
			console.log(
				`[Auth] Callback server listening on http://localhost:${port}`,
			);
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
				console.error("[Auth] Failed to open browser:", error.message);
				reject(error);
			} else {
				resolve();
			}
		});
	});
}

/**
 * Perform OAuth login flow for Claude.ai
 */
async function loginClaude(): Promise<void> {
	console.log("[Auth] Starting Claude.ai OAuth login...");

	// Load client ID from credentials
	const clientId = await loadClientId();
	if (!clientId) {
		console.error(
			"❌ No client ID configured. Please add 'claude-oauth-client-id' to credentials.json",
		);
		console.log(
			"   Run: apohara config --set claude-oauth-client-id=YOUR_CLIENT_ID",
		);
		process.exit(1);
	}

	// Generate PKCE verifier and challenge
	const codeVerifier = generateCodeVerifier();
	const codeChallenge = generateCodeChallenge(codeVerifier);

	console.log("[Auth] Generated PKCE code_verifier and code_challenge");

	// Find an available port for callback
	const callbackPort = await findAvailablePort(28563, 28599);
	const redirectUri = `http://localhost:${callbackPort}/callback`;

	console.log(`[Auth] Starting callback server on port ${callbackPort}...`);

	// Start callback server
	const { server, code: codePromise } = await startCallbackServer(callbackPort);

	try {
		// Build authorization URL
		const authUrl = new URL(CLAUDE_OAUTH_CONFIG.authorizationEndpoint);
		authUrl.searchParams.set("client_id", clientId);
		authUrl.searchParams.set("redirect_uri", redirectUri);
		authUrl.searchParams.set("response_type", "code");
		authUrl.searchParams.set("scope", CLAUDE_OAUTH_CONFIG.scope);
		authUrl.searchParams.set("code_challenge", codeChallenge);
		authUrl.searchParams.set("code_challenge_method", "S256");

		console.log("[Auth] Opening browser for authentication...");
		console.log(
			`[Auth] Authorization URL: ${authUrl.toString().replace(clientId, "***")}`,
		);

		// Open browser
		await openBrowser(authUrl.toString());

		console.log("[Auth] Waiting for authorization code...");

		// Wait for authorization code
		const authCode = await codePromise;

		if (!authCode) {
			console.error("❌ No authorization code received");
			process.exit(1);
		}

		console.log("[Auth] Received authorization code, exchanging for tokens...");

		// Exchange code for tokens
		const tokenResponse = await fetch(CLAUDE_OAUTH_CONFIG.tokenEndpoint, {
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
			}),
		});

		if (!tokenResponse.ok) {
			const errorText = await tokenResponse.text();
			console.error(
				"❌ Token exchange failed:",
				tokenResponse.status,
				errorText,
			);
			process.exit(1);
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

		// Save tokens
		const tokenPath = getOAuthCredentialsPath("claude");
		const token = {
			access_token: tokenData.access_token,
			refresh_token: tokenData.refresh_token,
			token_type: tokenData.token_type,
			expires_at: expiresAt,
			scope: tokenData.scope,
		};

		// Ensure directory exists
		await fs.mkdir(path.dirname(tokenPath), { recursive: true });
		await fs.writeFile(tokenPath, JSON.stringify(token, null, 2), "utf-8");
		await fs.chmod(tokenPath, 0o600);

		console.log(`✅ Authentication successful!`);
		console.log(`   Token saved to: ${tokenPath}`);
		console.log(`   Expires at: ${new Date(expiresAt).toLocaleString()}`);
	} finally {
		server.close();
	}
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
 * Show authentication status for a provider
 */
async function showStatus(provider: string): Promise<void> {
	const tokenPath = getOAuthCredentialsPath(provider);

	try {
		const content = await fs.readFile(tokenPath, "utf-8");
		const token = JSON.parse(content);

		const expiresAt = new Date(token.expires_at);
		const now = new Date();
		const isExpired = expiresAt < now;
		const expiresIn = Math.round(
			(expiresAt.getTime() - now.getTime()) / 1000 / 60,
		); // minutes

		console.log(`\n📋 ${provider} Authentication Status:`);
		console.log(`   Token type: ${token.token_type}`);
		console.log(`   Expires at: ${expiresAt.toLocaleString()}`);
		console.log(`   Status: ${isExpired ? "❌ Expired" : "✅ Valid"}`);

		if (!isExpired && expiresIn < 60) {
			console.log(`   Expires in: ${expiresIn} minutes`);
		} else if (!isExpired) {
			const hours = Math.round(expiresIn / 60);
			console.log(`   Expires in: ${hours} hours`);
		}

		if (token.refresh_token) {
			console.log(`   Refresh token: ✅ Available`);
		} else {
			console.log(`   Refresh token: ❌ Not available`);
		}

		if (token.scope) {
			console.log(`   Scope: ${token.scope}`);
		}

		console.log("");
	} catch {
		console.log(`\n📋 ${provider} Authentication Status:`);
		console.log(`   Status: ❌ Not authenticated`);
		console.log(`   Run: apohara auth login ${provider}`);
		console.log("");
	}
}

// Export auth command
export const authCommand = new Command("auth").description(
	"Manage OAuth authentication for Claude.ai and other providers",
);

// Login subcommand
authCommand
	.command("login <provider>")
	.description("Login to an OAuth provider (e.g., claude, gemini)")
	.action(async (provider: string) => {
		console.log(`[Auth] Login command invoked for provider: ${provider}`);

		if (provider === "claude") {
			await loginClaude();
		} else if (provider === "gemini") {
			// Import and use gemini OAuth. `loadClientId` is intentionally
			// not re-exported from gemini.ts — the inline credentials.json
			// lookup below handles it for the login flow.
			const { loginWithGoogleOAuth, saveApoharaToken } = await import(
				"../lib/oauth/gemini.js"
			);

			console.log("[Auth] Starting Gemini OAuth login...");

			// Load client ID from credentials
			const credPath = process.env.XDG_CONFIG_HOME
				? path.join(process.env.XDG_CONFIG_HOME, "apohara", "credentials.json")
				: path.join(os.homedir(), ".apohara", "credentials.json");

			let clientId = "";
			try {
				const content = await fs.readFile(credPath, "utf-8");
				const parsed = JSON.parse(content);
				clientId = parsed["gemini-oauth-client-id"] || "";
			} catch {
				// No credentials file
			}

			if (!clientId) {
				console.error(
					"❌ No client ID configured. Please add 'gemini-oauth-client-id' to credentials.json",
				);
				console.log(
					"   Run: apohara config --set gemini-oauth-client-id=YOUR_CLIENT_ID",
				);
				process.exit(1);
			}

			// Perform OAuth flow
			const token = await loginWithGoogleOAuth(clientId);
			await saveApoharaToken(token);

			console.log(`✅ Gemini authentication successful!`);
			console.log(
				`   Expires at: ${new Date(token.expires_at).toLocaleString()}`,
			);
		} else {
			console.error(`❌ Unknown provider: ${provider}`);
			console.log("   Supported providers: claude, gemini");
			process.exit(1);
		}
	});

// Status subcommand
authCommand
	.command("status [provider]")
	.description("Show authentication status (default: claude)")
	.action(async (provider?: string) => {
		const targetProvider = provider || "claude";

		if (targetProvider === "gemini") {
			// Show gemini status using the gemini OAuth module
			const { getGeminiTokenInfo } = await import("../lib/oauth/gemini.js");

			try {
				const info = await getGeminiTokenInfo();

				console.log("\n📋 Gemini Authentication Status:");
				console.log(`   Source: ${info.source || "none"}`);

				if (info.present) {
					console.log(`   Token type: ${info.token_type}`);
					console.log(`   Expires at: ${info.expires_at}`);
					console.log(
						`   Status: ${info.is_expired ? "❌ Expired" : "✅ Valid"}`,
					);
					console.log(
						`   Refresh token: ${info.has_refresh_token ? "✅ Available" : "❌ Not available"}`,
					);
				} else {
					console.log(`   Status: ❌ Not authenticated`);
					console.log(`   Run: apohara auth login gemini`);
				}
				console.log("");
			} catch (error) {
				console.error("[Auth] Failed to get Gemini status:", error);
			}
			return;
		}

		await showStatus(targetProvider);
	});
