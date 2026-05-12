import * as fs from "node:fs/promises";
import { Command } from "commander";
import {
	ensureDir,
	getConfigDir,
	getCredentialsPath,
	showPaths,
} from "../lib/paths.js";

const CREDENTIALS_TEMPLATE = {
	OPENCODE_API_KEY: "",
	DEEPSEEK_API_KEY: "",
	ANTHROPIC_API_KEY: "",
	OPENAI_API_KEY: "",
	GOOGLE_AI_STUDIO_API_KEY: "",
};

/**
 * Sanitizes API key for safe logging (shows only last 4 chars).
 */
function sanitizeKey(key: string | undefined): string {
	if (!key || key.length < 4) return "****";
	return `****${key.slice(-4)}`;
}

/**
 * Validation result with details.
 */
interface ValidationResult {
	valid: boolean;
	error?: string;
}

/**
 * Validates API key format for different providers.
 * Anthropic requires sk-ant-api03-* keys (not sk-ant-oat01-* OAuth tokens).
 * OpenCode Go and Google AI Studio have specific format requirements.
 */
function validateApiKey(keyName: string, value: string): ValidationResult {
	if (!value) {
		// Empty is allowed (user can skip)
		return { valid: true };
	}

	switch (keyName) {
		case "ANTHROPIC_API_KEY":
			// Anthropic keys start with sk-ant-api03-
			if (!value.startsWith("sk-ant-api03-")) {
				return {
					valid: false,
					error: `Invalid Anthropic API key format. Keys must start with 'sk-ant-api03-'. Note: OAuth tokens (sk-ant-oat01-*) are not supported.`,
				};
			}
			// Check minimum length
			if (value.length < 40) {
				return {
					valid: false,
					error: `Invalid Anthropic API key: too short (minimum 40 characters).`,
				};
			}
			break;

		case "OPENCODE_API_KEY":
			// OpenCode Go keys typically start with oc- or opencode-
			if (!value.startsWith("oc-") && !value.startsWith("opencode-")) {
				return {
					valid: false,
					error: `Invalid OpenCode API key format. Keys must start with 'oc-' or 'opencode-'.`,
				};
			}
			if (value.length < 20) {
				return {
					valid: false,
					error: `Invalid OpenCode API key: too short (minimum 20 characters).`,
				};
			}
			break;

		case "OPENAI_API_KEY":
			// OpenAI keys start with sk- or sk-proj-
			if (!value.startsWith("sk-") && !value.startsWith("sk-proj-")) {
				return {
					valid: false,
					error: `Invalid OpenAI API key format. Keys must start with 'sk-' or 'sk-proj-'.`,
				};
			}
			if (value.length < 40) {
				return {
					valid: false,
					error: `Invalid OpenAI API key: too short (minimum 40 characters).`,
				};
			}
			break;

		case "DEEPSEEK_API_KEY":
			// DeepSeek keys typically start with sk- or deepseek-
			if (!value.startsWith("sk-") && !value.startsWith("deepseek-")) {
				return {
					valid: false,
					error: `Invalid DeepSeek API key format. Keys must start with 'sk-' or 'deepseek-'.`,
				};
			}
			if (value.length < 20) {
				return {
					valid: false,
					error: `Invalid DeepSeek API key: too short (minimum 20 characters).`,
				};
			}
			break;

		case "GOOGLE_AI_STUDIO_API_KEY":
			// Google AI Studio keys start with AIza and are 39 characters total (AIza + 35 chars)
			if (!value.startsWith("AIza")) {
				return {
					valid: false,
					error: `Invalid Google AI Studio API key format. Keys must start with 'AIza'.`,
				};
			}
			if (value.length !== 39) {
				return {
					valid: false,
					error: `Invalid Google AI Studio API key: must be exactly 39 characters (AIza + 35 chars).`,
				};
			}
			break;

		default:
			// Basic length check for unknown providers
			if (value.length < 10) {
				return {
					valid: false,
					error: `Invalid API key for ${keyName}: too short (minimum 10 characters).`,
				};
			}
			break;
	}

	return { valid: true };
}

/**
 * Prompts user for input using readline.
 */
async function prompt(label: string, defaultValue?: string): Promise<string> {
	const readline = await import("node:readline/promises");
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	const promptText = defaultValue
		? `${label} [${sanitizeKey(defaultValue)}]: `
		: `${label}: `;

	try {
		const answer = await rl.question(promptText);
		return answer.trim() || defaultValue || "";
	} finally {
		rl.close();
	}
}

/**
 * Prompts user for secure (password-style) input using readline.
 * Input is hidden from terminal (no echo).
 */
async function promptSecure(
	label: string,
	defaultValue?: string,
): Promise<string> {
	const readline = await import("node:readline/promises");

	const isTTY = process.stdin.isTTY;

	if (!isTTY) {
		// Fallback for non-TTY environments (piped input)
		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
		});
		const promptText = defaultValue
			? `${label} [${sanitizeKey(defaultValue)}]: `
			: `${label}: `;
		try {
			const answer = await rl.question(promptText);
			return answer.trim() || defaultValue || "";
		} finally {
			rl.close();
		}
	}

	// For TTY, use readline
	// Note: True password masking requires raw mode which is complex.
	// For now we use the built-in readline which shows input.
	// A future enhancement could use keypress events for true masking.
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	const promptText = defaultValue
		? `${label} [${sanitizeKey(defaultValue)}]: `
		: `${label}: `;

	try {
		const answer = await rl.question(promptText);
		return answer.trim() || defaultValue || "";
	} finally {
		rl.close();
	}
}

/**
 * Prompts for confirmation.
 */
async function confirm(label: string, defaultYes = true): Promise<boolean> {
	const readline = await import("node:readline/promises");
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	const suffix = defaultYes ? " [Y/n]" : " [y/N]";
	try {
		const answer = await rl.question(`${label}${suffix}: `);
		const normalized = answer.trim().toLowerCase();
		if (!normalized) return defaultYes;
		return normalized === "y" || normalized === "yes";
	} finally {
		rl.close();
	}
}

/**
 * Loads existing credentials.
 */
async function loadCredentials(): Promise<typeof CREDENTIALS_TEMPLATE> {
	try {
		const credPath = getCredentialsPath();
		await fs.access(credPath);
		const content = await fs.readFile(credPath, "utf-8");
		const parsed = JSON.parse(content);
		// Merge with template to ensure all fields exist
		return { ...CREDENTIALS_TEMPLATE, ...parsed };
	} catch {
		return { ...CREDENTIALS_TEMPLATE };
	}
}

/**
 * Saves credentials with secure permissions (600).
 */
async function saveCredentials(
	credentials: typeof CREDENTIALS_TEMPLATE,
): Promise<boolean> {
	try {
		const configDir = getConfigDir();
		if (!ensureDir(configDir)) {
			console.error("❌ Failed to create config directory");
			return false;
		}

		const credPath = getCredentialsPath();
		await fs.writeFile(credPath, JSON.stringify(credentials, null, 2), "utf-8");
		await fs.chmod(credPath, 0o600);
		console.log(`✅ Saved credentials to ${credPath} (600 permissions)`);
		return true;
	} catch (err) {
		console.error("❌ Failed to save credentials:", err);
		return false;
	}
}

/**
 * Runs interactive config wizard.
 */
async function runWizard(): Promise<void> {
	console.log("\n🔧 Apohara Configuration Wizard");
	console.log("Press Ctrl+C to cancel at any time\n");

	const existing = await loadCredentials();
	const fields = [
		{ key: "OPENCODE_API_KEY", label: "OpenCode API Key", secure: true },
		{ key: "DEEPSEEK_API_KEY", label: "DeepSeek API Key", secure: true },
		{ key: "ANTHROPIC_API_KEY", label: "Anthropic API Key", secure: true },
		{ key: "OPENAI_API_KEY", label: "OpenAI API Key", secure: true },
		{
			key: "GOOGLE_AI_STUDIO_API_KEY",
			label: "Google AI Studio API Key",
			secure: true,
		},
	];

	const credentials = { ...existing };

	for (const field of fields) {
		let value = field.secure
			? await promptSecure(
					field.label,
					existing[field.key as keyof typeof CREDENTIALS_TEMPLATE],
				)
			: await prompt(
					field.label,
					existing[field.key as keyof typeof CREDENTIALS_TEMPLATE],
				);

		// Validate API key format before storing
		const validation = validateApiKey(field.key, value);
		if (!validation.valid) {
			console.log(`\n⚠️  ${validation.error}`);
			const retry = await confirm("Try again?", false);
			if (retry) {
				value = field.secure
					? await promptSecure(field.label, "")
					: await prompt(field.label, "");
				// Re-validate after retry
				const retryValidation = validateApiKey(field.key, value);
				if (!retryValidation.valid) {
					console.log(`\n❌ Invalid key format. Skipping ${field.label}.`);
					value = "";
				}
			} else {
				value = "";
			}
		}

		credentials[field.key as keyof typeof CREDENTIALS_TEMPLATE] = value;
	}

	// Show summary
	console.log("\n📋 Summary:");
	for (const field of fields) {
		const value = credentials[field.key as keyof typeof CREDENTIALS_TEMPLATE];
		console.log(
			`  ${field.label}: ${value ? sanitizeKey(value) : "(not set)"}`,
		);
	}

	const save = await confirm("\nSave credentials?", true);
	if (save) {
		await saveCredentials(credentials);
		console.log("\n✅ Configuration complete!");
	} else {
		console.log("\n❌ Configuration not saved.");
	}
}

export const configCommand = new Command("config")
	.description("Configure API keys and settings")
	.option("--show-paths", "Show resolved config paths", false)
	.option(
		"--set <key=value>",
		"Set a config value (e.g., --set OPENCODE_API_KEY=xxx)",
	)
	.action(async (options: { showPaths?: boolean; set?: string }) => {
		if (options.showPaths) {
			showPaths();
			return;
		}

		if (options.set) {
			// Handle --set key=value
			const [key, ...valueParts] = options.set.split("=");
			const value = valueParts.join("=");

			if (!key || !Object.hasOwn(CREDENTIALS_TEMPLATE, key)) {
				console.error(`❌ Unknown key: ${key}`);
				console.log(
					`Valid keys: ${Object.keys(CREDENTIALS_TEMPLATE).join(", ")}`,
				);
				process.exit(1);
			}

			// Validate API key format before saving
			const validation = validateApiKey(key, value);
			if (!validation.valid) {
				console.error(`❌ ${validation.error}`);
				process.exit(1);
			}

			const credentials = await loadCredentials();
			credentials[key as keyof typeof CREDENTIALS_TEMPLATE] = value;
			await saveCredentials(credentials);
			console.log(`✅ Set ${key}=${sanitizeKey(value)}`);
			return;
		}

		// Run interactive wizard
		await runWizard();
	});
