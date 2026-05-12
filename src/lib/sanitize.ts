/**
 * Centralized API key redaction utilities
 * Wraps console.log, console.error, stderr, and fs.appendFileSync to prevent API key leakage
 */

/** Regular expressions for API key patterns */
export const REDACTION_PATTERNS = [
	// OpenAI API keys: sk- followed by 32+ alphanumeric characters
	/sk-[a-zA-Z0-9]{32,}/g,
	// Google AI (Gemini) API keys: AIza followed by 35 alphanumeric chars
	/AIza[0-9A-Za-z_-]{35}/g,
	// Anthropic API keys: sk-ant- followed by alphanumeric
	/sk-ant-[a-zA-Z0-9_-]{32,}/g,
	// Generic AWS access keys (20 char alphanumeric)
	/AKIA[0-9A-Z]{16}/g,
	// Generic secret keys (40 char base64)
	/[A-Za-z0-9]{40}/g,
];

/** Replacement string for redacted values */
export const REDACTED_PLACEHOLDER = "[REDACTED]";

/** Debug mode flag - when true, shows what was redacted */
let debugMode = false;

/** Enable debug mode to see redaction details */
export function enableDebugMode(): void {
	debugMode = true;
}

/** Disable debug mode */
export function disableDebugMode(): void {
	debugMode = false;
}

/** Check if debug mode is enabled */
export function isDebugMode(): boolean {
	return debugMode;
}

/**
 * Redact API keys from a string
 * @param input - The string to sanitize
 * @returns The sanitized string with API keys replaced
 */
export function redact(input: string): string {
	if (typeof input !== "string") {
		return input;
	}

	let result = input;

	for (const pattern of REDACTION_PATTERNS) {
		const matches = result.match(pattern);
		if (matches && debugMode) {
			console.log(
				`[sanitize] Redacting ${matches.length} instance(s) of ${pattern}`,
			);
		}
		result = result.replace(pattern, REDACTED_PLACEHOLDER);
	}

	return result;
}

/**
 * Redact all strings in an object recursively
 * @param obj - Object to sanitize
 * @returns Sanitized object
 */
export function redactObject<T>(obj: T): T {
	if (obj === null || obj === undefined) {
		return obj;
	}

	if (typeof obj === "string") {
		return redact(obj) as unknown as T;
	}

	if (typeof obj === "object") {
		if (Array.isArray(obj)) {
			return obj.map((item) => redactObject(item)) as unknown as T;
		}

		const result: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(obj)) {
			result[key] = redactObject(value);
		}
		return result as T;
	}

	return obj;
}

/** Store the original console methods */
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
const originalConsoleInfo = console.info;

/**
 * Wrap console methods to automatically redact API keys from output
 */
export function wrapConsole(): void {
	console.log = (...args: unknown[]) => {
		const redacted = args.map((arg) => {
			if (typeof arg === "string") {
				return redact(arg);
			}
			if (typeof arg === "object") {
				return redactObject(arg);
			}
			return arg;
		});
		originalConsoleLog(...redacted);
	};

	console.error = (...args: unknown[]) => {
		const redacted = args.map((arg) => {
			if (typeof arg === "string") {
				return redact(arg);
			}
			if (typeof arg === "object") {
				return redactObject(arg);
			}
			return arg;
		});
		originalConsoleError(...redacted);
	};

	console.warn = (...args: unknown[]) => {
		const redacted = args.map((arg) => {
			if (typeof arg === "string") {
				return redact(arg);
			}
			if (typeof arg === "object") {
				return redactObject(arg);
			}
			return arg;
		});
		originalConsoleWarn(...redacted);
	};

	console.info = (...args: unknown[]) => {
		const redacted = args.map((arg) => {
			if (typeof arg === "string") {
				return redact(arg);
			}
			if (typeof arg === "object") {
				return redactObject(arg);
			}
			return arg;
		});
		originalConsoleInfo(...redacted);
	};
}

/**
 * Unwrap console methods to restore original behavior
 */
export function unwrapConsole(): void {
	console.log = originalConsoleLog;
	console.error = originalConsoleError;
	console.warn = originalConsoleWarn;
	console.info = originalConsoleInfo;
}

/**
 * Redact-safe wrapper for fs.appendFileSync
 * Automatically redacts API keys before writing to files
 */
export async function safeAppendFile(
	filePath: string,
	data: string,
	encoding: BufferEncoding = "utf8",
): Promise<void> {
	const fs = await import("fs");
	const redactedData = redact(data);
	fs.appendFileSync(filePath, redactedData, encoding);
}

/**
 * Redact-safe wrapper for fs.appendFileSync (sync version)
 */
export function safeAppendFileSync(
	filePath: string,
	data: string,
	encoding: BufferEncoding = "utf8",
): void {
	const fs = require("fs");
	const redactedData = redact(data);
	fs.appendFileSync(filePath, redactedData, encoding);
}

/**
 * Check if a string contains any API key patterns
 * Useful for validation and detecting potential leaks
 * @param input - String to check
 * @returns True if any API key pattern is found
 */
export function containsApiKey(input: string): boolean {
	if (typeof input !== "string") {
		return false;
	}

	return REDACTION_PATTERNS.some((pattern) => pattern.test(input));
}

/**
 * Get count of API keys found in a string
 * @param input - String to analyze
 * @returns Number of API keys found
 */
export function countApiKeys(input: string): number {
	if (typeof input !== "string") {
		return 0;
	}

	let count = 0;
	for (const pattern of REDACTION_PATTERNS) {
		const matches = input.match(pattern);
		if (matches) {
			count += matches.length;
		}
	}
	return count;
}
